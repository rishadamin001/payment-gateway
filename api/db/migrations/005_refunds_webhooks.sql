BEGIN;
CREATE TABLE IF NOT EXISTS merchant_webhooks (
 merchant_id UUID PRIMARY KEY REFERENCES merchants(id), enabled BOOLEAN NOT NULL DEFAULT true,
 signing_secret TEXT NOT NULL, receiver_mode TEXT NOT NULL DEFAULT 'success' CHECK(receiver_mode IN ('success','fail_twice','always_fail')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL REFERENCES merchants(id),
 event_type TEXT NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RETRY','DELIVERED','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 locked_until TIMESTAMPTZ, lease_id UUID, delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webhook_due ON webhook_events(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_id UUID NOT NULL REFERENCES webhook_events(id),
 attempt INTEGER NOT NULL, http_status INTEGER, result TEXT NOT NULL, signature_valid BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(event_id,attempt)
);
CREATE TABLE IF NOT EXISTS webhook_receipts (
 event_id UUID PRIMARY KEY REFERENCES webhook_events(id), received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_refunds (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payment_id UUID NOT NULL REFERENCES payments(id),
 merchant_id UUID NOT NULL REFERENCES merchants(id), amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
 status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK(status='SUCCEEDED'),
 idempotency_key VARCHAR(128) NOT NULL, request_fingerprint CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(merchant_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS refund_payment ON payment_refunds(payment_id);
CREATE TABLE IF NOT EXISTS refund_status_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, refund_id UUID NOT NULL REFERENCES payment_refunds(id),
 status TEXT NOT NULL CHECK(status IN ('REQUESTED','SUCCEEDED')), changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION paybd_queue_payment_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM merchant_webhooks WHERE merchant_id=NEW.merchant_id AND enabled) THEN
  INSERT INTO webhook_events(merchant_id,event_type,payload)
  VALUES(NEW.merchant_id,CASE WHEN TG_OP='INSERT' THEN 'payment.created' ELSE 'payment.status_changed' END,
  jsonb_build_object('payment_id',NEW.id,'merchant_order_id',NEW.merchant_order_id,'status',NEW.status,'amount_paisa',NEW.amount_paisa,'currency',NEW.currency,'test_mode',true));
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_webhook_payment_insert AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION paybd_queue_payment_webhook();
CREATE OR REPLACE TRIGGER paybd_webhook_payment_update AFTER UPDATE OF status ON payments FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION paybd_queue_payment_webhook();
CREATE OR REPLACE FUNCTION paybd_guard_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE; already BIGINT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Refunds are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 IF p.merchant_id IS DISTINCT FROM NEW.merchant_id OR p.status NOT IN ('PAID','PARTIALLY_REFUNDED') THEN
  RAISE EXCEPTION 'Refund requires the merchant own paid payment' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(amount_paisa),0) INTO already FROM payment_refunds WHERE payment_id=NEW.payment_id;
 IF already+NEW.amount_paisa>p.amount_paisa THEN RAISE EXCEPTION 'Refund exceeds remaining amount' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION paybd_finish_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE refunded BIGINT; total BIGINT;
BEGIN
 SELECT COALESCE(sum(amount_paisa),0) INTO refunded FROM payment_refunds WHERE payment_id=NEW.payment_id;
 SELECT amount_paisa INTO total FROM payments WHERE id=NEW.payment_id;
 UPDATE payments SET status=CASE WHEN refunded=total THEN 'REFUNDED' ELSE 'PARTIALLY_REFUNDED' END WHERE id=NEW.payment_id;
 INSERT INTO refund_status_history(refund_id,status) VALUES(NEW.id,'REQUESTED'),(NEW.id,'SUCCEEDED');
 IF EXISTS(SELECT 1 FROM merchant_webhooks WHERE merchant_id=NEW.merchant_id AND enabled) THEN
  INSERT INTO webhook_events(merchant_id,event_type,payload) VALUES(NEW.merchant_id,'refund.succeeded',jsonb_build_object('refund_id',NEW.id,'payment_id',NEW.payment_id,'amount_paisa',NEW.amount_paisa,'status','SUCCEEDED','test_mode',true));
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION paybd_guard_refund();
CREATE OR REPLACE TRIGGER paybd_refund_finish AFTER INSERT ON payment_refunds FOR EACH ROW EXECUTE FUNCTION paybd_finish_refund();
-- Refund triggers update payments inside a trigger, so audit inserts are nested
-- one level deeper than direct payment transitions. Direct history writes still fail.
CREATE OR REPLACE FUNCTION public.paybd_guard_payment_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth() IN (2,3) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Payment history is append-only and managed by payment transitions' USING ERRCODE='23514';
END; $$;
COMMIT;

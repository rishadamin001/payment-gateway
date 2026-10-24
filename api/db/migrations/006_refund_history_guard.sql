BEGIN;
-- Older payment states may predate amount-level refund records. Preserve those
-- states, but never assume a legacy partial refund returned zero paisa.
CREATE OR REPLACE FUNCTION paybd_guard_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p payments%ROWTYPE; already BIGINT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Refunds are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 IF p.merchant_id IS DISTINCT FROM NEW.merchant_id OR p.status NOT IN ('PAID','PARTIALLY_REFUNDED') THEN
  RAISE EXCEPTION 'Refund requires the merchant own paid payment' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(amount_paisa),0) INTO already FROM payment_refunds WHERE payment_id=NEW.payment_id;
 IF p.status='PARTIALLY_REFUNDED' AND already=0 THEN
  RAISE EXCEPTION 'Previous partial refund amount is unknown' USING ERRCODE='23514'; END IF;
 IF already+NEW.amount_paisa>p.amount_paisa THEN RAISE EXCEPTION 'Refund exceeds remaining amount' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_refund_no_truncate BEFORE TRUNCATE ON payment_refunds
 FOR EACH STATEMENT EXECUTE FUNCTION paybd_guard_refund();

CREATE OR REPLACE FUNCTION paybd_guard_refund_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND pg_trigger_depth()=2 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Refund history is append-only and managed by refunds' USING ERRCODE='23514';
END; $$;
CREATE OR REPLACE TRIGGER paybd_refund_history_guard
 BEFORE INSERT OR UPDATE OR DELETE ON refund_status_history
 FOR EACH ROW EXECUTE FUNCTION paybd_guard_refund_history();
CREATE OR REPLACE TRIGGER paybd_refund_history_no_truncate
 BEFORE TRUNCATE ON refund_status_history
 FOR EACH STATEMENT EXECUTE FUNCTION paybd_guard_refund_history();
COMMIT;

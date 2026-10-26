BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_sessions (
 token_hash CHAR(64) PRIMARY KEY, admin_id UUID NOT NULL REFERENCES public.admin_accounts(id),
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 identity_hash CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_attempt_window ON public.admin_login_attempts(identity_hash,created_at);
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS public.audit_log (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_type TEXT NOT NULL CHECK(actor_type IN ('ADMIN','SYSTEM')),
 actor_id UUID REFERENCES public.admin_accounts(id),
 merchant_id UUID REFERENCES public.merchants(id),
 action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK((metadata - ARRAY['status','from_status','amount_paisa','reason','approved','payment_id','invoice_id','settlement_id'])='{}'::jsonb)
);
CREATE INDEX IF NOT EXISTS audit_log_recent ON public.audit_log(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_log_merchant ON public.audit_log(merchant_id,id DESC);
CREATE OR REPLACE FUNCTION public.paybd_keep_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Audit records are append-only' USING ERRCODE='23514';
END; $$;
CREATE OR REPLACE TRIGGER paybd_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_log
 FOR EACH ROW EXECUTE FUNCTION public.paybd_keep_audit();
CREATE OR REPLACE TRIGGER paybd_audit_no_truncate BEFORE TRUNCATE ON public.audit_log
 FOR EACH STATEMENT EXECUTE FUNCTION public.paybd_keep_audit();

-- Suspension applies to every payment entry point, including direct SQL and
-- an already-issued checkout link. Existing receipts and refunds stay readable.
CREATE OR REPLACE FUNCTION public.paybd_require_active_merchant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR (NEW.status='PAID' AND OLD.status IS DISTINCT FROM NEW.status) THEN
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=NEW.merchant_id AND status='ACTIVE') THEN
   RAISE EXCEPTION 'Merchant is not active for simulated payments' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_merchant_payment_guard BEFORE INSERT OR UPDATE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.paybd_require_active_merchant();

-- Only explicitly selected fields enter the audit log. Passwords, key hashes,
-- session tokens, webhook signatures and invoice customer data are never copied.
CREATE OR REPLACE FUNCTION public.paybd_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rowdata JSONB:=to_jsonb(NEW); previous JSONB:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 event TEXT; merchant UUID; details JSONB:='{}'; actor UUID; actor_text TEXT;
BEGIN
 merchant:=NULLIF(rowdata->>'merchant_id','')::uuid;
 CASE TG_TABLE_NAME
 WHEN 'merchants' THEN
  merchant:=NEW.id;
  IF TG_OP='INSERT' THEN event:='merchant.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN event:='merchant.status_changed';
  ELSE RETURN NEW; END IF;
  details:=jsonb_build_object('status',NEW.status,'from_status',previous->>'status','approved',NEW.approved_at IS NOT NULL);
 WHEN 'payments' THEN
  IF TG_OP='INSERT' THEN event:='payment.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event:='payment.status_changed';
  ELSE RETURN NEW; END IF;
  details:=jsonb_build_object('status',NEW.status,'from_status',previous->>'status','amount_paisa',NEW.amount_paisa);
 WHEN 'payment_refunds' THEN
  event:='refund.succeeded';details:=jsonb_build_object('status',NEW.status,'amount_paisa',NEW.amount_paisa,'payment_id',NEW.payment_id);
 WHEN 'payment_links' THEN
  event:='payment_link.created';details:=jsonb_build_object('amount_paisa',NEW.amount_paisa);
 WHEN 'invoices' THEN
  IF TG_OP='INSERT' THEN event:='invoice.created';
  ELSIF NEW.status='SENT' AND OLD.status IS DISTINCT FROM NEW.status THEN event:='invoice.sent';
  ELSIF NEW.status='PAID' AND OLD.status IS DISTINCT FROM NEW.status THEN event:='invoice.paid';
  ELSE RETURN NEW; END IF;
  details:=jsonb_build_object('status',NEW.status,'amount_paisa',NEW.amount_paisa);
 WHEN 'invoice_reminders' THEN
  SELECT merchant_id INTO merchant FROM public.invoices WHERE id=NEW.invoice_id;
  event:='invoice.reminder';details:=jsonb_build_object('invoice_id',NEW.invoice_id);
 WHEN 'merchant_api_keys' THEN
  IF TG_OP='INSERT' THEN event:='api_key.created';
  ELSIF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN event:='api_key.revoked';
  ELSE RETURN NEW; END IF;
 WHEN 'simulated_settlements' THEN
  event:='settlement.created';details:=jsonb_build_object('amount_paisa',NEW.amount_paisa);
 WHEN 'simulated_payouts' THEN
  event:='payout.succeeded';details:=jsonb_build_object('amount_paisa',NEW.amount_paisa,'status',NEW.status,'settlement_id',NEW.settlement_id);
 ELSE RETURN NEW;
 END CASE;
 actor_text:=current_setting('paybd.admin_actor',true);
 IF actor_text ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
  SELECT id INTO actor FROM public.admin_accounts WHERE id=actor_text::uuid;
 END IF;
 IF actor IS NOT NULL AND TG_TABLE_NAME='merchants' THEN
  details:=details||jsonb_build_object('reason',left(COALESCE(current_setting('paybd.admin_reason',true),''),200));
 END IF;
 INSERT INTO public.audit_log(actor_type,actor_id,merchant_id,action,entity_type,entity_id,metadata)
 VALUES(CASE WHEN actor IS NULL THEN 'SYSTEM' ELSE 'ADMIN' END,actor,merchant,event,TG_TABLE_NAME,rowdata->>'id',details);
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_audit_merchants AFTER INSERT OR UPDATE ON public.merchants FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_payments AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_refunds AFTER INSERT ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_links AFTER INSERT ON public.payment_links FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_invoices AFTER INSERT OR UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_reminders AFTER INSERT ON public.invoice_reminders FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_keys AFTER INSERT OR UPDATE OF revoked_at ON public.merchant_api_keys FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_settlements AFTER INSERT ON public.simulated_settlements FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
CREATE OR REPLACE TRIGGER paybd_audit_payouts AFTER INSERT ON public.simulated_payouts FOR EACH ROW EXECUTE FUNCTION public.paybd_audit_change();
COMMIT;

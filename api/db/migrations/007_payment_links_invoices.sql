BEGIN;
CREATE TABLE IF NOT EXISTS public.payment_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id UUID NOT NULL REFERENCES public.merchants(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
 amount_paisa BIGINT NOT NULL CHECK(amount_paisa BETWEEN 1 AND 100000000000),
 reusable BOOLEAN NOT NULL DEFAULT false,
 expires_at TIMESTAMPTZ NOT NULL,
 settled_payment_id UUID REFERENCES public.payments(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_links_merchant ON public.payment_links(merchant_id,created_at DESC);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_link_id UUID REFERENCES public.payment_links(id);
CREATE INDEX IF NOT EXISTS payment_link_payments ON public.payments(payment_link_id,created_at);
CREATE TABLE IF NOT EXISTS public.invoices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id UUID NOT NULL REFERENCES public.merchants(id),
 customer_name TEXT NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 120),
 customer_email TEXT NOT NULL CHECK(length(customer_email) BETWEEN 3 AND 254),
 due_at TIMESTAMPTZ NOT NULL,
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 30),
 amount_paisa BIGINT NOT NULL CHECK(amount_paisa BETWEEN 1 AND 100000000000),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PAID')),
 link_id UUID UNIQUE REFERENCES public.payment_links(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ, paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invoices_merchant ON public.invoices(merchant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.invoice_reminders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id UUID NOT NULL REFERENCES public.invoices(id),
 message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_reminders_invoice ON public.invoice_reminders(invoice_id,created_at);

CREATE OR REPLACE FUNCTION public.paybd_guard_link_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link public.payment_links%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.payment_link_id IS DISTINCT FROM OLD.payment_link_id THEN
  RAISE EXCEPTION 'Payment link identity is immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.payment_link_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR (NEW.status='PAID' AND OLD.status IS DISTINCT FROM NEW.status) THEN
  SELECT * INTO link FROM public.payment_links WHERE id=NEW.payment_link_id FOR UPDATE;
  IF link.id IS NULL OR link.merchant_id<>NEW.merchant_id OR link.amount_paisa<>NEW.amount_paisa THEN
   RAISE EXCEPTION 'Payment does not match its link' USING ERRCODE='23514';
  END IF;
  IF link.expires_at<=clock_timestamp() OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>link.expires_at THEN
   RAISE EXCEPTION 'Payment link is expired' USING ERRCODE='23514';
  END IF;
  IF NOT link.reusable AND link.settled_payment_id IS NOT NULL AND link.settled_payment_id<>NEW.id THEN
   RAISE EXCEPTION 'One-time payment link already paid' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NOT link.reusable AND EXISTS(SELECT 1 FROM public.payments WHERE payment_link_id=link.id AND status='PENDING' AND expires_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'One-time payment link already has a pending checkout' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_link_payment_guard BEFORE INSERT OR UPDATE ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.paybd_guard_link_payment();

CREATE OR REPLACE FUNCTION public.paybd_settle_payment_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payment_link_id IS NOT NULL THEN
  UPDATE public.payment_links SET settled_payment_id=COALESCE(settled_payment_id,NEW.id) WHERE id=NEW.payment_link_id;
  UPDATE public.invoices SET status='PAID',paid_at=now() WHERE link_id=NEW.payment_link_id AND status='SENT';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_link_payment_settled AFTER UPDATE OF status ON public.payments
 FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status AND NEW.status='PAID') EXECUTE FUNCTION public.paybd_settle_payment_link();

CREATE OR REPLACE FUNCTION public.paybd_guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item JSONB; calculated NUMERIC:=0; link public.payment_links%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoices are retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'DRAFT' OR NEW.link_id IS NOT NULL THEN RAISE EXCEPTION 'Invoice starts as draft' USING ERRCODE='23514'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
   IF jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'unit_amount_paisa') IS DISTINCT FROM 'number'
      OR (item->>'quantity')::numeric<>trunc((item->>'quantity')::numeric)
      OR (item->>'unit_amount_paisa')::numeric<>trunc((item->>'unit_amount_paisa')::numeric)
      OR (item->>'quantity')::numeric NOT BETWEEN 1 AND 10000
      OR (item->>'unit_amount_paisa')::numeric NOT BETWEEN 1 AND 100000000000
      OR length(COALESCE(item->>'description','')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid invoice line item' USING ERRCODE='23514';
   END IF;
   calculated:=calculated+(item->>'quantity')::numeric*(item->>'unit_amount_paisa')::numeric;
  END LOOP;
  IF calculated<>NEW.amount_paisa THEN RAISE EXCEPTION 'Invoice total does not match items' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.merchant_id,NEW.customer_name,NEW.customer_email,NEW.due_at,NEW.items,NEW.amount_paisa,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.merchant_id,OLD.customer_name,OLD.customer_email,OLD.due_at,OLD.items,OLD.amount_paisa,OLD.created_at) THEN
   RAISE EXCEPTION 'Invoice details are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'DRAFT' AND NEW.link_id IS DISTINCT FROM OLD.link_id THEN RAISE EXCEPTION 'Invoice payment link is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='SENT' AND OLD.status='DRAFT' THEN
   SELECT * INTO link FROM public.payment_links WHERE id=NEW.link_id;
   IF link.id IS NULL OR link.merchant_id<>NEW.merchant_id OR link.amount_paisa<>NEW.amount_paisa OR link.reusable THEN
    RAISE EXCEPTION 'Invoice requires its own one-time payment link' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.status='PAID' AND OLD.status='SENT' THEN
   IF NOT EXISTS(SELECT 1 FROM public.payment_links l JOIN public.payments p ON p.id=l.settled_payment_id WHERE l.id=OLD.link_id AND p.status='PAID') THEN
    RAISE EXCEPTION 'Invoice requires a paid payment' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.link_id IS DISTINCT FROM OLD.link_id THEN
   RAISE EXCEPTION 'Invalid invoice transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
 FOR EACH ROW EXECUTE FUNCTION public.paybd_guard_invoice();
CREATE OR REPLACE FUNCTION public.paybd_guard_payment_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.settled_payment_id IS NOT NULL THEN RAISE EXCEPTION 'Payment links start unpaid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment links are retained' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.id,NEW.merchant_id,NEW.title,NEW.amount_paisa,NEW.reusable,NEW.expires_at,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.merchant_id,OLD.title,OLD.amount_paisa,OLD.reusable,OLD.expires_at,OLD.created_at) THEN
  RAISE EXCEPTION 'Payment link details are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.settled_payment_id IS DISTINCT FROM OLD.settled_payment_id AND
   (OLD.settled_payment_id IS NOT NULL OR pg_trigger_depth()<>2 OR NOT EXISTS(
     SELECT 1 FROM public.payments p WHERE p.id=NEW.settled_payment_id AND p.payment_link_id=NEW.id AND p.status='PAID')) THEN
  RAISE EXCEPTION 'Link settlement is managed by payment completion' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_payment_link_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_links
 FOR EACH ROW EXECUTE FUNCTION public.paybd_guard_payment_link();
COMMIT;

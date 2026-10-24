-- M2/M3: all checkout and shop activity is simulated. Existing payments retained.
BEGIN;

CREATE TABLE IF NOT EXISTS public.checkout_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('card','bkash','nagad','rocket','bank')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 minutes'),
  superseded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_outcome TEXT CHECK (completed_outcome IN ('success','failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT checkout_completion_pair CHECK ((completed_at IS NULL) = (completed_outcome IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_checkout_challenge_payment
  ON public.checkout_challenges (payment_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_one_active_challenge
  ON public.checkout_challenges (payment_id)
  WHERE superseded_at IS NULL AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id UUID PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  request_fingerprint CHAR(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_merchant ON public.shop_orders (merchant_id, created_at DESC);

-- A snapshot may be attached only to its own merchant's payment. Once written,
-- the order is immutable; its current state is always read from payments.
CREATE OR REPLACE FUNCTION public.paybd_guard_shop_order()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_merchant UUID;
DECLARE payment_amount BIGINT;
DECLARE items_amount BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Shop order snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT merchant_id, amount_paisa INTO payment_merchant, payment_amount
    FROM public.payments WHERE id = NEW.id;
  IF payment_merchant IS DISTINCT FROM NEW.merchant_id THEN
    RAISE EXCEPTION 'Shop order merchant must match its payment' USING ERRCODE = '23514';
  END IF;
  SELECT sum((item->>'line_total_paisa')::bigint) INTO items_amount
    FROM jsonb_array_elements(NEW.items) item;
  IF items_amount IS DISTINCT FROM payment_amount THEN
    RAISE EXCEPTION 'Shop order total must match its payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER paybd_shop_order_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.paybd_guard_shop_order();

COMMIT;

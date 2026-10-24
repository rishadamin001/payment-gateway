-- PayBD Demo / MIS465 -- baseline migration
-- Documents the manually-created table without deleting or replacing it.
-- DEMO MODE: no real money.

CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.merchants IS
  'PayBD Demo merchant accounts; all payments are simulated.';

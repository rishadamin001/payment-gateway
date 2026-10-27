BEGIN;
-- Marks an additive classroom sample batch. No existing merchant data is replaced.
CREATE TABLE IF NOT EXISTS public.demo_sample_batches (
 merchant_id UUID PRIMARY KEY REFERENCES public.merchants(id),
 id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version=1),
 counts JSONB NOT NULL CHECK(jsonb_typeof(counts)='object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;

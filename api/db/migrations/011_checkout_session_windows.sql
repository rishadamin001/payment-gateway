-- Shorter demo checkout windows apply only to newly created records.
-- Existing payment/challenge deadlines and all state history remain unchanged.
BEGIN;
ALTER TABLE public.payments
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '2 minutes');
ALTER TABLE public.checkout_challenges
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 seconds');
COMMIT;

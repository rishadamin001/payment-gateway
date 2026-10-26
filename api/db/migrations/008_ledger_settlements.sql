BEGIN;
-- All balances are fictional paisa. No bank or provider is contacted.
CREATE TABLE IF NOT EXISTS merchant_finance_locks(merchant_id UUID PRIMARY KEY REFERENCES merchants(id));
CREATE TABLE IF NOT EXISTS simulated_settlements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id UUID NOT NULL REFERENCES merchants(id),
 amount_paisa BIGINT NOT NULL CHECK(amount_paisa BETWEEN 1 AND 100000000000),
 idempotency_key VARCHAR(128) NOT NULL,request_fingerprint CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(merchant_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS simulated_payouts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),settlement_id UUID NOT NULL UNIQUE REFERENCES simulated_settlements(id),
 merchant_id UUID NOT NULL REFERENCES merchants(id),amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),
 status TEXT NOT NULL DEFAULT 'SUCCEEDED' CHECK(status='SUCCEEDED'),
 idempotency_key VARCHAR(128) NOT NULL,request_fingerprint CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(merchant_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS ledger_journals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id UUID NOT NULL REFERENCES merchants(id),
 source_type TEXT NOT NULL CHECK(source_type IN ('PAYMENT','REFUND','LEGACY_REFUND','SETTLEMENT','PAYOUT')),
 source_id UUID NOT NULL,amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,journal_id UUID NOT NULL REFERENCES ledger_journals(id),
 account TEXT NOT NULL CHECK(account IN ('CLEARING','MERCHANT_PAYABLE','SETTLEMENT_PAYABLE')),
 side TEXT NOT NULL CHECK(side IN ('DEBIT','CREDIT')),amount_paisa BIGINT NOT NULL CHECK(amount_paisa>0),
 UNIQUE(journal_id,side)
);
CREATE INDEX IF NOT EXISTS ledger_merchant_created ON ledger_journals(merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS settlement_merchant ON simulated_settlements(merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payout_merchant ON simulated_payouts(merchant_id,created_at DESC);
CREATE OR REPLACE FUNCTION paybd_lock_finance(merchant UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO merchant_finance_locks(merchant_id) VALUES(merchant) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM merchant_finance_locks WHERE merchant_id=merchant FOR UPDATE;
END; $$;
CREATE OR REPLACE FUNCTION paybd_finance_balance(merchant UUID,ledger_account TEXT) RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
 SELECT COALESCE(sum(CASE WHEN e.side='CREDIT' THEN e.amount_paisa ELSE -e.amount_paisa END),0)::bigint
 FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE j.merchant_id=merchant AND e.account=ledger_account
$$;
CREATE OR REPLACE FUNCTION paybd_unknown_refunds(merchant UUID) RETURNS BIGINT LANGUAGE sql VOLATILE AS $$
 SELECT count(*) FROM payments p WHERE p.merchant_id=merchant AND p.status='PARTIALLY_REFUNDED'
 AND NOT EXISTS(SELECT 1 FROM payment_refunds r WHERE r.payment_id=p.id)
$$;
CREATE OR REPLACE FUNCTION paybd_finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial records are append-only' USING ERRCODE='23514'; END; $$;
CREATE OR REPLACE TRIGGER paybd_ledger_journal_immutable BEFORE UPDATE OR DELETE ON ledger_journals FOR EACH ROW EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_ledger_entry_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_settlement_immutable BEFORE UPDATE OR DELETE ON simulated_settlements FOR EACH ROW EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_payout_immutable BEFORE UPDATE OR DELETE ON simulated_payouts FOR EACH ROW EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_ledger_journal_no_truncate BEFORE TRUNCATE ON ledger_journals FOR EACH STATEMENT EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_ledger_entry_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_settlement_no_truncate BEFORE TRUNCATE ON simulated_settlements FOR EACH STATEMENT EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE TRIGGER paybd_payout_no_truncate BEFORE TRUNCATE ON simulated_payouts FOR EACH STATEMENT EXECUTE FUNCTION paybd_finance_immutable();
CREATE OR REPLACE FUNCTION paybd_guard_finance_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_merchant UUID;source_amount BIGINT;
BEGIN
 PERFORM paybd_lock_finance(NEW.merchant_id);
 IF NEW.source_type='PAYMENT' THEN
  SELECT merchant_id,amount_paisa INTO source_merchant,source_amount FROM payments WHERE id=NEW.source_id AND status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED');
 ELSIF NEW.source_type='REFUND' THEN
  SELECT merchant_id,amount_paisa INTO source_merchant,source_amount FROM payment_refunds WHERE id=NEW.source_id;
 ELSIF NEW.source_type='LEGACY_REFUND' THEN
  SELECT p.merchant_id,p.amount_paisa-COALESCE((SELECT sum(r.amount_paisa) FROM payment_refunds r WHERE r.payment_id=p.id),0)
   INTO source_merchant,source_amount FROM payments p WHERE p.id=NEW.source_id AND p.status='REFUNDED';
 ELSIF NEW.source_type='SETTLEMENT' THEN
  SELECT merchant_id,amount_paisa INTO source_merchant,source_amount FROM simulated_settlements WHERE id=NEW.source_id;
 ELSIF NEW.source_type='PAYOUT' THEN
  SELECT merchant_id,amount_paisa INTO source_merchant,source_amount FROM simulated_payouts WHERE id=NEW.source_id;
 END IF;
 IF source_merchant IS DISTINCT FROM NEW.merchant_id OR source_amount IS DISTINCT FROM NEW.amount_paisa THEN
  RAISE EXCEPTION 'Ledger journal must match a real simulated source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE TRIGGER paybd_ledger_source_guard BEFORE INSERT ON ledger_journals FOR EACH ROW EXECUTE FUNCTION paybd_guard_finance_source();
CREATE OR REPLACE FUNCTION paybd_check_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal UUID;header ledger_journals%ROWTYPE;n INTEGER;debit NUMERIC;credit NUMERIC;correct INTEGER;
BEGIN
 IF TG_TABLE_NAME='ledger_journals' THEN journal:=NEW.id; ELSE journal:=NEW.journal_id; END IF;
 SELECT * INTO header FROM ledger_journals WHERE id=journal;
 SELECT count(*),COALESCE(sum(amount_paisa) FILTER(WHERE side='DEBIT'),0),COALESCE(sum(amount_paisa) FILTER(WHERE side='CREDIT'),0)
  INTO n,debit,credit FROM ledger_entries WHERE journal_id=journal;
 SELECT count(*) INTO correct FROM ledger_entries WHERE journal_id=journal AND
  (side='DEBIT' AND account=CASE header.source_type WHEN 'PAYMENT' THEN 'CLEARING' WHEN 'PAYOUT' THEN 'SETTLEMENT_PAYABLE' ELSE 'MERCHANT_PAYABLE' END
   OR side='CREDIT' AND account=CASE header.source_type WHEN 'PAYMENT' THEN 'MERCHANT_PAYABLE' WHEN 'SETTLEMENT' THEN 'SETTLEMENT_PAYABLE' ELSE 'CLEARING' END);
 IF n<>2 OR correct<>2 OR debit<>credit OR debit<>header.amount_paisa THEN
  RAISE EXCEPTION 'Journal requires equal source-sized debits and credits in the correct accounts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='paybd_journal_balanced' AND tgrelid='ledger_journals'::regclass) THEN
  CREATE CONSTRAINT TRIGGER paybd_journal_balanced AFTER INSERT ON ledger_journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION paybd_check_journal_balance();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='paybd_entry_balanced' AND tgrelid='ledger_entries'::regclass) THEN
  CREATE CONSTRAINT TRIGGER paybd_entry_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION paybd_check_journal_balance();
 END IF;
END; $$;
CREATE OR REPLACE FUNCTION paybd_post_ledger(merchant UUID,kind TEXT,source UUID,paisa BIGINT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE journal UUID;
BEGIN
 INSERT INTO ledger_journals(merchant_id,source_type,source_id,amount_paisa) VALUES(merchant,kind,source,paisa)
 ON CONFLICT(source_type,source_id) DO NOTHING RETURNING id INTO journal;
 IF journal IS NOT NULL THEN
  INSERT INTO ledger_entries(journal_id,account,side,amount_paisa) VALUES
   (journal,CASE kind WHEN 'PAYMENT' THEN 'CLEARING' WHEN 'PAYOUT' THEN 'SETTLEMENT_PAYABLE' ELSE 'MERCHANT_PAYABLE' END,'DEBIT',paisa),
   (journal,CASE kind WHEN 'PAYMENT' THEN 'MERCHANT_PAYABLE' WHEN 'SETTLEMENT' THEN 'SETTLEMENT_PAYABLE' ELSE 'CLEARING' END,'CREDIT',paisa);
 END IF;
END; $$;
CREATE OR REPLACE FUNCTION paybd_ledger_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE remaining BIGINT;
BEGIN
 IF NEW.status='PAID' THEN PERFORM paybd_post_ledger(NEW.merchant_id,'PAYMENT',NEW.id,NEW.amount_paisa); END IF;
 IF NEW.status='REFUNDED' THEN
  SELECT NEW.amount_paisa-COALESCE(sum(amount_paisa),0) INTO remaining FROM payment_refunds WHERE payment_id=NEW.id;
  IF remaining>0 THEN PERFORM paybd_post_ledger(NEW.merchant_id,'LEGACY_REFUND',NEW.id,remaining); END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION paybd_ledger_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM paybd_post_ledger(NEW.merchant_id,'REFUND',NEW.id,NEW.amount_paisa);RETURN NEW;END; $$;
CREATE OR REPLACE TRIGGER paybd_ledger_payment AFTER UPDATE OF status ON payments FOR EACH ROW
 WHEN(OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('PAID','REFUNDED')) EXECUTE FUNCTION paybd_ledger_payment();
CREATE OR REPLACE TRIGGER paybd_ledger_refund AFTER INSERT ON payment_refunds FOR EACH ROW EXECUTE FUNCTION paybd_ledger_refund();
CREATE OR REPLACE FUNCTION paybd_guard_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM paybd_lock_finance(NEW.merchant_id);
 IF NOT EXISTS(SELECT 1 FROM merchants WHERE id=NEW.merchant_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Merchant is not active' USING ERRCODE='23514'; END IF;
 IF paybd_unknown_refunds(NEW.merchant_id)>0 THEN RAISE EXCEPTION 'Unknown legacy refund amounts require review' USING ERRCODE='23514'; END IF;
 IF NEW.amount_paisa>paybd_finance_balance(NEW.merchant_id,'MERCHANT_PAYABLE') THEN RAISE EXCEPTION 'Settlement exceeds available balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION paybd_guard_payout() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settlement simulated_settlements%ROWTYPE;
BEGIN
 PERFORM paybd_lock_finance(NEW.merchant_id);
 SELECT * INTO settlement FROM simulated_settlements WHERE id=NEW.settlement_id;
 IF settlement.merchant_id IS DISTINCT FROM NEW.merchant_id OR settlement.amount_paisa IS DISTINCT FROM NEW.amount_paisa THEN
  RAISE EXCEPTION 'Payout must match its merchant settlement' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM merchants WHERE id=NEW.merchant_id AND status='ACTIVE') THEN RAISE EXCEPTION 'Merchant is not active' USING ERRCODE='23514'; END IF;
 IF paybd_unknown_refunds(NEW.merchant_id)>0 THEN RAISE EXCEPTION 'Unknown legacy refund amounts require review' USING ERRCODE='23514'; END IF;
 IF NEW.amount_paisa>paybd_finance_balance(NEW.merchant_id,'SETTLEMENT_PAYABLE') OR NEW.amount_paisa> -paybd_finance_balance(NEW.merchant_id,'CLEARING') THEN
  RAISE EXCEPTION 'Payout exceeds reserved or clearing balance after refunds' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION paybd_ledger_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM paybd_post_ledger(NEW.merchant_id,'SETTLEMENT',NEW.id,NEW.amount_paisa);RETURN NEW;END; $$;
CREATE OR REPLACE FUNCTION paybd_ledger_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM paybd_post_ledger(NEW.merchant_id,'PAYOUT',NEW.id,NEW.amount_paisa);RETURN NEW;END; $$;
CREATE OR REPLACE TRIGGER paybd_settlement_guard BEFORE INSERT ON simulated_settlements FOR EACH ROW EXECUTE FUNCTION paybd_guard_settlement();
CREATE OR REPLACE TRIGGER paybd_payout_guard BEFORE INSERT ON simulated_payouts FOR EACH ROW EXECUTE FUNCTION paybd_guard_payout();
CREATE OR REPLACE TRIGGER paybd_ledger_settlement AFTER INSERT ON simulated_settlements FOR EACH ROW EXECUTE FUNCTION paybd_ledger_settlement();
CREATE OR REPLACE TRIGGER paybd_ledger_payout AFTER INSERT ON simulated_payouts FOR EACH ROW EXECUTE FUNCTION paybd_ledger_payout();
-- Backfill known history without changing payment/refund rows. Unknown partial refunds remain visible discrepancies.
DO $$ DECLARE p RECORD;r RECORD;remaining BIGINT;BEGIN
 FOR p IN SELECT id,merchant_id,amount_paisa FROM payments WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') ORDER BY merchant_id,id LOOP
  PERFORM paybd_post_ledger(p.merchant_id,'PAYMENT',p.id,p.amount_paisa);
 END LOOP;
 FOR r IN SELECT id,merchant_id,amount_paisa FROM payment_refunds ORDER BY merchant_id,id LOOP
  PERFORM paybd_post_ledger(r.merchant_id,'REFUND',r.id,r.amount_paisa);
 END LOOP;
 FOR p IN SELECT id,merchant_id,amount_paisa FROM payments WHERE status='REFUNDED' ORDER BY merchant_id,id LOOP
  SELECT p.amount_paisa-COALESCE(sum(amount_paisa),0) INTO remaining FROM payment_refunds WHERE payment_id=p.id;
  IF remaining>0 THEN PERFORM paybd_post_ledger(p.merchant_id,'LEGACY_REFUND',p.id,remaining); END IF;
 END LOOP;
END; $$;
COMMIT;

BEGIN;
CREATE TABLE IF NOT EXISTS merchant_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id),
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS merchant_sessions (
 token_hash CHAR(64) PRIMARY KEY, account_id UUID NOT NULL REFERENCES merchant_accounts(id),
 expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS merchant_login_attempts (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, identity_hash CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_login_attempts_identity ON merchant_login_attempts(identity_hash,created_at);
COMMIT;

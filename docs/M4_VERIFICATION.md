# M4 verified in cloud

24 October 2026. Additive migration004; migrations001–003 unchanged.

- `npm run verify`: passed with supplied existing DATABASE_URL and separate existing TEST_DATABASE_URL.
- 27 unit tests, 169 PostgreSQL/HTTP integration tests passed.
- API/Next builds, web lint, M1/M2/M3/M4 live smoke checks passed.
- Chromium browser: signup/login/logout, demo checkout, charts, filters, CSV,
  timeline, masked one-time key creation/revocation and mobile width passed.
- Passwords use random-salted scrypt. Session tokens are random, stored only as hashes,
  HttpOnly/SameSite cookies expire after eight hours. Logout revokes the server session.
- Transaction filters, export and details are scoped to the session merchant. CSV cells
  neutralize formula prefixes. Charts aggregate all matching records (latest60 active
  days in chart); gross revenue includes paid/refunded states before refund deductions.
- New classroom accounts activate automatically. The legacy public demo workspace and
  shop retain their seeded merchant; they do not switch to newly signed-in merchants.
- Test API keys are shown once in a masked field. Live keys are disabled.
- Existing rows retained; unique test fixtures remain in the separate test database.
- Native Windows batch/PowerShell/browser auto-open remains outstanding. START_HERE.md
  documents existing PostgreSQL startup without Docker or saved credential files.

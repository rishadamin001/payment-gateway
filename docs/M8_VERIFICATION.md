# M8 — presentation polish and delivery

Cloud verification on 28 October 2026 (Asia/Dhaka). Everything remains DEMO MODE:
no real money, cards, PINs, OTPs, providers, banks, email or SMS.

## Delivered

- Migration 010 records one additive sample batch per merchant. The startup seed
  adds Riverbank Craft Studio without a preset login or changes to existing users.
- **Load fictional examples** adds 26 payments across all seven states, four real
  simulated refund records, seven links, four invoice states, reminders, signed
  local webhook events, two settlements and one payout to a fresh active account.
  Concurrent calls create one batch. Existing records and webhook settings remain.
  Suspended accounts are blocked; unknown legacy refund amounts are not guessed.
- Local Swagger `/docs` and `/openapi.json` describe every controller operation,
  authentication, integer paisa, idempotency and PDF/PNG/CSV responses. Swagger
  serves its assets locally, does not persist credentials and permits GET trials.
- `/architecture` explains the payment journey, database state rules, ledger,
  local webhook worker and demo boundaries. README, Windows quick start, complete
  click-through checklist and eight-minute presentation script are included.

## Executed checks

- `npm run verify`: **41 unit tests and 210 integration tests passed**, API and
  Next production builds passed, web lint passed, migrations and repeatable seeds
  passed, and all M1–M8 live smoke suites passed (exit 0).
- Six new integration tests cover sample authentication/CSRF, concurrent loading,
  isolation, preserved settings/data, all states, refund histories, balanced
  reconciliation and suspended merchants. Three OpenAPI tests verify operation
  coverage, unique identifiers, references and key protocol details.
- Retained test fixtures exposed an old webhook test's empty-queue assumption.
  Internal dispatch can now scope its work to that test merchant; normal worker
  dispatch still handles all merchants. No queue or database was cleared.
- Chromium M4, M5, M6, M7 and M8 browser scripts all passed against the final
  production app. They exercised sessions, checkout, filters/CSV, keys, refunds,
  HMAC retries, QR/PDF downloads, invoices, ledger, settlement/payout, reconciliation,
  separate admin login, approval/suspension, risk/audit, samples and Swagger.
  Mobile layout assertions passed. M8 observed no external browser requests or
  JavaScript page errors. Dashboard and architecture screenshots were reviewed.
- Launcher JavaScript syntax checks passed. Both production startup and repeated
  migration/seed execution retained existing data. The launcher refuses to create
  a missing test database automatically.
- `scripts/windows-start.mjs` ran on Linux with an existing DATABASE_URL: both
  frozen dependency installs, migrations, repeatable seeds and normal dev startup
  passed. M8 Chromium checks passed again on that launcher-started app. This tests
  the shared code path, not native Windows shell behavior.

## Windows and product limits

Native `start-demo.bat`, the hidden PowerShell prompt, browser auto-opening,
Downloads permissions and Windows Ctrl+C process cleanup remain for laptop testing.
Node 24, running PostgreSQL and ports 3000/3001 are required. First installation
needs Internet; antivirus/firewall policy and dependency installation time vary.
The Windows launcher takes DATABASE_URL in memory and needs neither Docker nor an
.env file. Local QR links work on the same laptop; phone access needs a reachable
deployment. PDF text uses a Latin-script font. Legacy unknown partial refunds are
explicit reconciliation exceptions. Admin first-use setup is for a local classroom
instance, not public production deployment. No databases were dropped or reset.

## Main changed files

`api/db/migrations/010_demo_samples.sql`, `api/db/seed-m8.mjs`,
`api/src/showcase/`, `api/src/documentation/`, the API module/bootstrap and dependency
lockfile, webhook test scoping, `api/test/showcase.e2e-spec.ts`, M8 smoke/browser
scripts, `scripts/dev.mjs`, merchant/admin navigation, `web/app/architecture/`,
`README.md`, `START_HERE.md`, `docs/CLICK_THROUGH.md` and `docs/PRESENTATION.md`.

M6 and M7 evidence remains in their separate verification documents. The final
M8 source branch includes all earlier milestones through normal commit ancestry.

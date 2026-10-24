# M1 verification record

Verified in the Linux cloud workspace on 24 October 2026 (Asia/Dhaka).
Node.js 24.19.0, PostgreSQL 18, NestJS 12, Next.js 16.4.2.

| Check | Executed result |
| --- | --- |
| Frozen dependency installation | API and web npm ci passed; reusable cloud installer executed successfully |
| API production build | Passed |
| Unit tests | 19 passed in 3 files |
| PostgreSQL + HTTP integration tests | 123 passed in 1 file |
| Next.js production build | Passed, including TypeScript checks |
| Web ESLint | Passed |
| Complete npm run verify | Passed after cleaning generated Next build caches |
| Migrations 001 and 002 | Applied successfully; repeated run skipped both via checksum ledger |
| Seed repeatability | First run 84 payments; second run 0 added; four fictional merchants |
| Seed state coverage | Three active merchants each have 28 seeded payments and all seven states |
| Live HTTP smoke | Health/merchants, auth, validation, create/lookup, replay/conflict, ten-way concurrency, transition rollback, all seven states passed |
| Chromium desktop/mobile checks | Live data, filters/search, history, create, exact paisa, lookup error, guide, checkout information and mobile width passed; no page errors |
| Browser request protection | Missing Origin, unrelated Origin and mismatched Host rejected with 403; valid localhost reached validation and browser creation succeeded |
| Launcher lifecycle | Default and optimized startup exercised; cancellation during build exited without starting app servers |
| Secret hygiene | No full literal test API keys in source; environment/key/build paths ignored; browser HTML contained no full test key |

Integration includes a 49-case state matrix, initial-state rejection, immutable details
and history, revoked/inactive credentials, merchant isolation, 20-way identical request
concurrency and a 12-way conflicting-body race. SQL mutation checks roll back; unique
HTTP fixtures remain in the separate test database. Live smoke/browser checks add
clearly named fictional records to the demo database without deleting any data.

Browser validation used Playwright with system Chromium. It is separate from the
repository's npm verify command. Desktop and mobile screenshots were captured outside
the checkout. Tests discovered and prompted fixes for the Next request-origin comparison
and a positioned accessibility label causing mobile document overflow.

## Main source changes

- `api/db/migrations/001_merchants_baseline.sql`, `002_payments_core.sql`: baseline,
  payment/API-key/history schema and database rules.
- `api/db/migrate.mjs`, `seed-m1.mjs`: transactional migrations and repeatable fictional data.
- `api/src/payments/*`: authenticated payment creation, listing, lookup, validation and tests.
- `api/src/db.ts`, `app.controller.ts`, `app.module.ts`, `main.ts`, `http-error.filter.ts`:
  shared database connection, existing endpoints, safe startup and errors.
- `api/test/app.e2e-spec.ts`, `api/scripts/smoke-m1.mjs`: database/HTTP verification.
- `web/app/*`, `web/lib/*`: responsive dashboard, server-side API proxy, guide and
  informational checkout page; key stays on the server.
- `scripts/dev.mjs`, root/app package scripts, Git ignores, README and setup docs:
  repeatable local installation/startup/verification with no manually created secret files.

## Limits

This is verified M1, not a real gateway or M2 checkout. Windows execution was not available;
the source includes a cross-platform Node launcher for local use with Node24 and Docker.
The Windows project directory was not modified by this cloud task. SSLCommerz access
was blocked by the network proxy; the interface is an original PayBD design.

Cloud install_script and start_skill were saved as a configuration draft. Publication
and restoration in a fresh cloud task have not been performed or verified. The M1 commit
is local and unpushed; keep the source archive because local-only commit restoration is
not guaranteed by the cloud snapshot workflow.

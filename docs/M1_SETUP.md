# PayBD Demo — Milestone M1

**DEMO MODE: no real money.** This MIS465 classroom application uses fictional
merchants and simulated payment records. PayBD is an independent educational project,
not SSLCommerz and not connected to any payment provider.

## Quick start

Requirements: Node.js 24, npm, Docker Desktop/Engine, and free local ports 3000, 3001,
and 5432. From the project root (PowerShell or a POSIX shell):

```sh
npm run setup
npm run demo
```

Setup uses the supplied lockfiles. The launcher starts its labelled `paybd-m1-postgres`
container with PostgreSQL 18 and the persistent `paybd-m1-postgres18` volume. The database
port is bound to loopback only; local trust authentication is solely for this isolated
classroom database. Do not expose this database or app as a production service.

A random test key is generated in memory, passed through process environments, and
stored only as a SHA-256 hash in the database. No key is displayed or written to `.env`.
Relaunching rotates only the previous launcher-created test key. Other merchant keys
and existing records are preserved. Keep this terminal open while using the demo.

The API listens on local port 3000 and the dashboard on local port 3001. On your local
machine, open localhost on port 3001 in a browser. Cloud tasks require the environment's
supported viewing workflow; cloud-local addresses are not public deployments.

Create a PENDING payment and inspect its history. The dashboard shows the merchant's
latest 100 payments, with search and state filters. Totals describe this sample. Money
is stored/transmitted as integer paisa and displayed in Bangladeshi taka. Checkout links
show an M1 information page; no payment capture or state mutation is implemented there.

`npm run demo:production` builds and runs the optimized frontend. Ctrl+C stops app
processes; PostgreSQL and its records remain. Automatic expiry is outside M1.

## Existing databases and configuration

Configuration is read only from process environment variables. Scripts do not read
`.env` contents. Git ignores exclude `.env`, credential files, dependencies, and outputs.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Existing PostgreSQL connection; skips automatic Docker provisioning. |
| `TEST_DATABASE_URL` | Separate test database; required for verification with a supplied database. |
| `PAYBD_DEMO_API_KEY` | Optional existing test key: `paybd_test_` plus 43 base64url characters. Launcher generates one if absent. |
| `PAYBD_CHECKOUT_BASE_URL` | Checkout origin for direct API startup; default local port 3001. |
| `PAYBD_API_BASE_URL` | Backend origin used only by Next.js on the server. |
| `PAYBD_WEB_ORIGIN` | Optional exact trusted browser origin for custom direct web startup. Defaults allow local port 3001. |
| `PAYBD_API_URL` | Backend origin for direct smoke-test runs. Launcher forces its own local API. |
| `HOST`, `PORT` | API address/port for direct startup; default loopback and 3000. |

The launcher uses fixed local ports/origins. For custom ports, start each app directly
with process variables after installing, migrating, and seeding.

Existing merchants must use the documented UUID schema. Migration 001 records it with
`CREATE TABLE IF NOT EXISTS`, retaining all rows and statuses. Incompatible schemas
must be reconciled separately; do not reset or replace user data.

## Migrations and seed

From `api/`, with variables already in the process environment:

```sh
npm run db:migrate
npm run db:seed
```

The runner uses an advisory lock, atomic transactions, and a checksum ledger. Reruns
skip applied migrations; changed applied files are rejected. Restore the original and
add a new numbered migration. SQL files also work directly in PostgreSQL clients, but
the runner is preferred for tracking applications.

The seed inserts four fictional merchants and 84 payments: 28 for each of three active
merchants, covering all seven states for each. Repeat runs add zero duplicate payments.
Existing merchant fields and payment states remain unchanged. Incompatible seed identities
or revoked-key reuse fail safely. Newly seeded PENDING records are recent; existing
PENDING fixtures are not reset when their time window elapses.

## HTTP API

`GET /health` and `GET /merchants` remain available. Payment endpoints require
`Authorization: Bearer <test key supplied through your environment>`.

`POST /v1/payments` also requires `Idempotency-Key`: 8–128 characters, starting with a
letter or digit, using letters, digits, `.`, `_`, `:`, or `-`. Body:

```json
{
  "amount_paisa": 150000,
  "currency": "BDT",
  "merchant_order_id": "ORDER-1001",
  "success_url": "http://localhost:3001/demo/success",
  "cancel_url": "http://localhost:3001/demo/cancel"
}
```

Only these five fields are accepted. Amounts must be positive safe integers up to
100000000000 paisa. Currency is BDT. Redirects must be HTTP(S), without embedded
credentials; M1 stores them without fetching or executing them.

Creation returns 201 with `id`, `checkout_url`, `status: PENDING`, `amount_paisa`,
`amount_display`, timestamps, `test_mode: true`, and the demo notice. Identical normalized
requests with the same merchant/key return the original creation representation. Changed
details with that key return 409, including concurrent requests. A database unique
constraint ensures concurrency safety; idempotency keys are scoped to merchants.

`GET /v1/payments/:id` returns current state and ordered history for the authenticated
merchant. Missing/other-merchant records return 404. `GET /v1/payments` returns
`{ payments, merchant, test_mode, notice }` for the latest 100 merchant payments.
Missing/invalid/revoked keys return 401, inactive merchants 403, and invalid inputs 400.

Next.js keeps the API key on the server. Browser mutations enforce same-origin requests.
This is a local single-merchant sandbox, not a production merchant login system.

## State integrity

[The authoritative workflow](payment-workflow.md) permits exactly:

- PENDING → PAID, FAILED, CANCELLED, or EXPIRED.
- PAID → REFUNDED or PARTIALLY_REFUNDED.
- PARTIALLY_REFUNDED → REFUNDED.
- FAILED, CANCELLED, EXPIRED, and REFUNDED are terminal.

PostgreSQL enforces initial PENDING status, immutable identity/details, and allowed
transitions. History is appended atomically and cannot be directly inserted, changed,
or deleted. Same-status updates are no-ops and add no history. Database administrators
who disable triggers are outside this application integrity boundary.

## Verification

```sh
npm run verify
```

This runs API build/unit/integration checks, frontend lint/build, migrations/seed, and
live HTTP smoke requests. Integration tests use a separate database with unique fixtures;
transition matrix checks roll back their transactions. No database or existing records
are deleted. Checks cover authentication, validation, merchant isolation, idempotent
replay, concurrency, history, and state rules.

Individual commands: `npm --prefix api test`, `npm --prefix api run test:e2e`,
`npm --prefix web run lint`, and `npm run build`. E2E requires `TEST_DATABASE_URL`.
Live smoke: `npm --prefix api run smoke`, with the API running and its database URL and
test key already in the process environment.

## Scope

M1 includes payments core, history, fictional data, and the local dashboard. No real
funds, providers, card/PIN/OTP capture, live checkout, refunds API, expiry worker,
webhooks, payouts, or external publication. M2 requires confirmation.

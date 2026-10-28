# PayBD Demo — MIS465 (M1–M8)

**DEMO MODE: fake money only.** No real cards, PINs, OTPs, banks, providers, SMS or email. This educational payment gateway includes a shop, hosted checkout, merchant dashboard, refunds, signed local webhooks, payment links, invoices, double-entry accounting and administration.

## Start on Windows

Install Node.js 24 and keep your existing PostgreSQL database running. Extract into a new folder and double-click `start-demo.bat`. It uses DATABASE_URL from its environment or asks for it in a hidden prompt. No Docker or .env file is required. See [START_HERE.md](START_HERE.md).

## Explore

For an online classroom demo, use the prepared [Render deployment guide](docs/DEPLOY_RENDER.md)
and `render.yaml` on branch `deployment/render`. Public deployment still requires
the owner's hosting-account connection and review of the provider's charges.

| Page on local port 3001 | Features |
| --- | --- |
| /shop | Cart and five simulated checkout methods |
| /merchant | Signup/login, charts, search, filters, CSV, test keys and fictional examples |
| /merchant/webhooks | HMAC signatures, retries and delivery logs |
| /merchant/links | Expiring one-time/reusable links and QR images |
| /merchant/invoices | Line items, statuses, PDFs and in-app reminders |
| /merchant/finance | Journals, settlements, payouts and reconciliation |
| /admin | Separate login, merchant approval/suspension, risk and audit |
| /architecture | System design and demo boundaries |

Create your merchant account and click **Load fictional examples**. This adds sample data once without replacing records. Admin setup asks you to choose a separate password on first use. There are no preset passwords or live keys. Swagger is on API port 3000 at `/docs`; its OpenAPI document is `/openapi.json`.

## Develop and verify

Node.js 24, NestJS 12, Next.js 16 App Router, TypeScript, PostgreSQL 18. Supply DATABASE_URL securely in the process environment, then run:

```text
npm run setup
npm run demo
```

Stop apps before `npm run verify`; also supply TEST_DATABASE_URL for the separate existing payment_gateway_test database. Verification runs migrations, seeds, unit/integration tests, both builds, web lint and live smoke suites. Browser scripts are `api/scripts/browser-m4.mjs` through `browser-m8.mjs`, using Chromium through CHROMIUM_PATH (cloud default /usr/bin/chromium). M7 browser fixtures also require DATABASE_URL. No database is dropped or reset.

Amounts are integer paisa; screens display taka. Database constraints enforce payment transitions and balanced ledger entries. Merchant/admin sessions are separate; passwords and API keys are hashed. Webhooks use only the built-in local receiver. Add numbered migrations instead of editing applied ones.

See the [complete checklist](docs/CLICK_THROUGH.md), [eight-minute presentation](docs/PRESENTATION.md), [payment rules](docs/payment-workflow.md) and milestone verification documents in docs.

## Limits

Native Windows batch/PowerShell/browser-opening behavior remains to be verified on the laptop. First startup requires Internet for dependencies. The launcher binds to loopback, so QR links cannot work on another device without a reachable deployment. PDFs use a standard font intended for Latin-script demo text. Legacy partial refunds without recorded amounts remain review exceptions and block settlement. Risk flags are classroom heuristics. No production deployment or real payment integration is included.

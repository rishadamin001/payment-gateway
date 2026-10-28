# Optional free-plan Render deployment

The budget is zero. Prefer [the free temporary preview](FREE_PREVIEW.md) when
sharing the existing cloud demo. This branch's template now selects only free
plans. Do not deploy the earlier paid template or accept a payment/upgrade prompt.

Recommended layout: **one Node.js web service + one managed PostgreSQL database**.
The website, API and Swagger share one HTTPS address. NestJS and its local webhook
worker run privately inside the web service; Next.js is the public entry point.
Everything remains DEMO MODE. No real providers, banks, money, email or SMS.

## Account steps that require the owner

1. Sign in to [Render](https://dashboard.render.com/) with your GitHub account.
2. Choose **New → Blueprint**, connect `rishadamin001/payment-gateway`, and select
   branch **deployment/free-preview**. Render reads the included `render.yaml`.
3. Enter `PAYBD_ADMIN_EMAIL` and a new demo-only `PAYBD_ADMIN_PASSWORD` (12–128
   characters) in Render's secure fields. **Review Render's current recurring
   price before confirming deployment; it must be zero.** The template selects
   free web and PostgreSQL plans. Do not proceed if these are unavailable or cost
   money. No purchase has been made by Codex.
4. Wait for a successful deployment and open the web service's HTTPS URL. Send
   only that public URL back for remote verification; never send credentials.

Render performs installation, both builds, additive migrations, admin bootstrap,
fictional seeding and startup. DATABASE_URL is connected automatically through the
Blueprint. The server-only demo key seed is generated automatically and stays
stable between deployments. No .env file, Docker setup or manual SQL is needed.
The hosted database is separate from the existing Windows database. Its contents
are never copied from the laptop or cloud development fixtures.

## What to click

- `/shop`: add products → Pay → select a simulated method → fake OTP 000000 → result.
- `/merchant`: create your own fictional account → **Load fictional examples**.
  Explore transactions, refunds, webhooks, links, invoices and finance.
- `/admin`: sign in using the credentials entered securely during deployment.
  Hosted mode disables public first-admin signup, including direct API requests.
- `/architecture` and `/docs/`: explain the system and inspect Swagger.

Shareable links and QR codes use the hosted HTTPS address automatically. A custom
domain requires setting PAYBD_PUBLIC_URL to its exact HTTPS origin and redeploying;
existing links generated earlier keep their old address. Never put secrets into
NEXT_PUBLIC variables. Removing/replacing administrator environment values does
not reset an existing password or transfer the administrator account.

## Operation and limits

The launcher supervises both services and fails startup if the API/database is
unhealthy. `/health` is the hosting health check. SIGTERM stops both child services.
Startup uses the existing migration checksum checks and repeatable seeds; it never
drops, truncates or resets data. Use one instance for this classroom deployment.
Take database backups before future schema changes. Render controls TLS, hosting
availability and billing. Review its current plans and database retention terms.

This is a public classroom demo, not a production payment gateway. Use fictional
accounts and orders. The legacy shared demo workspace is intentionally shared.
Payments, balances, payouts and fraud hints have no real financial meaning.
Windows continues to use `start-demo.bat` with existing PostgreSQL as before.

## Verification status

Cloud regression checks passed: 43 API unit tests, 211 integration tests, two
hosted-configuration tests, both builds, web lint and M1–M8 live smoke suites.
The dedicated hosted browser script uses a temporary localhost HTTPS certificate
held in process memory; its certificate exception is confined to that local test.
It passed hosted startup, checkout/receipt, public link and checkout URLs, Secure
merchant/admin cookies, blocked public admin signup and same-origin Swagger/health.
Run it with apps stopped and DATABASE_URL in the environment:

```text
node api/scripts/browser-hosted.mjs
```

This browser script requires cloud Linux, Chromium, Bash and OpenSSL and creates
additive fictional fixtures. It is not part of normal Windows startup.

**Not yet verified on Render:** Blueprint acceptance, actual resource provisioning,
platform HTTPS/routing, plan capacity and the resulting public URL. No authenticated
Render connection is available to the agent. The YAML parses locally; provider
validation will occur when the owner connects the repository. Native Windows
batch/PowerShell checks remain outstanding as documented in START_HERE.md.

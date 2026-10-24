# PayBD Demo — M1 Payments Core

An educational Bangladesh payment gateway for MIS465. **DEMO MODE: no real money.**
No cards, PINs, OTPs, bank connections, or payment providers are used.

## Run locally

Install Node.js 24 and start Docker Desktop (or Docker Engine), then run from this directory:

```sh
npm run setup
npm run demo
```

The launcher prepares PostgreSQL 18, applies migrations, seeds fictional data, builds the
NestJS API, and starts the Next.js dashboard on **local port 3001** and API on **3000**.
Use your browser's localhost address on port 3001. Keep the terminal open; Ctrl+C stops
the app services. The database and fictional records are retained in a Docker volume.
No configuration files or copied credentials are required for this local workflow.

Create a PENDING payment, search/filter seeded payments, and view payment history.
Checkout links show an M1 information page; payment simulation controls, expiry workers,
refunds, and webhooks belong to later milestones.

## Verify

```sh
npm run verify
```

Stop the demo first so port 3000 is free. Verification runs migrations, repeatable seed,
API build and unit/integration tests, web lint/build, and live HTTP smoke tests.
Integration fixtures are isolated in `payment_gateway_test`; no database is dropped.
For an optimized local build, use `npm run demo:production`.

See [M1 setup and API contract](docs/M1_SETUP.md) and the authoritative
[payment workflow](docs/payment-workflow.md).

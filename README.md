# PayBD Demo — M1, M2 and M3

**DEMO MODE: no real money.** MIS465 educational payment gateway and shop.

Windows users: follow [the one-page startup guide](START_HERE.md) and double-click
`start-demo.bat`. Node.js 24 and an existing PostgreSQL database are required. The
launcher uses `DATABASE_URL` or prompts for it without displaying/saving its value.
Docker is not required with an existing database.

The shop on local port 3001 at `/shop` offers a cart and server-priced checkout.
Hosted checkout simulates Card, bKash, Nagad, Rocket and Bank using fictional accounts
and the advertised fake OTP `000000`. Try success, failure, cancel and expiry; the
shop receipt reads the real database payment state. No actual providers are connected.
The merchant dashboard remains at `/`, with payment history and test-key APIs.

For other platforms, with `DATABASE_URL` already in your environment:

```sh
npm run setup
npm run demo
```

If DATABASE_URL is absent, this developer command uses a local Docker PostgreSQL18
sandbox. The Windows batch launcher always asks for an existing database instead.

Stop apps before `npm run verify`. With your own PostgreSQL supply a separate
`TEST_DATABASE_URL` for tests. Verification runs migrations, seed, API build/unit/e2e,
web lint/build, and live M1–M3 smoke checks. No databases are dropped or reset.

See [verification](docs/M2_M3_VERIFICATION.md), [M1 API reference](docs/M1_SETUP.md),
and [state rules](docs/payment-workflow.md). Migrations001/002 remain unchanged;
003 adds checkout challenges and immutable shop order snapshots. Seeds preserve data.

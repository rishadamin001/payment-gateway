# M7 — finance and administration

Cloud verification on 27 October 2026 (Asia/Dhaka). All balances and transfers are
fictional integer paisa. No bank, payment provider or real money is involved.

## Accounting model

Every successful payment debits clearing and credits merchant payable. Every refund
reverses that movement. A settlement transfers merchant payable to settlement
payable; its simulated payout debits settlement payable and credits clearing.
Pending, failed, cancelled and expired requests create no monetary posting.
Every journal has exactly two entries, equal debits/credits, correct accounts and
an amount matching its source. Deferred database constraints enforce this at commit.
Journals, entries, settlements and payouts are append-only. Merchant finance locks
serialize concurrent withdrawals and refunds; duplicate keys replay existing results.

Migrations 008/009 add finance/admin tables and backfill known historical amounts
without changing any payment or refund. Fully refunded legacy payments have a known
total; older partial refunds without amount records remain explicit reconciliation
exceptions and block settlements/payouts. A refund after payout can create a negative
merchant balance; further settlements remain blocked until enough receipts arrive.
Payouts also require sufficient reserved and clearing balances.

## Administration

The administrator has a separate first-use setup, hashed password, expiring HttpOnly
session cookie, login throttling and logout revocation. Concurrent first setup has
one winner. Merchant approval is recorded; suspension blocks new payment channels
and completion of existing pending checkout. Existing records and refunds remain
available. Classroom signup remains automatically active for M4 compatibility.

Risk flags highlight amounts of at least BDT 100,000 and three or more failed attempts
within 24 hours. They are classroom heuristics, not fraud decisions. All-transaction
search and audit views are paginated. Audit metadata is restricted to safe fields;
passwords, API keys, session hashes and webhook signing material are excluded.

## Executed verification

- Full `npm run verify` passed: 38 unit tests, 204 integration tests, API/Next builds, web lint, migrations, repeatable seed and all M1–M7 live smoke suites.

- 13 targeted finance/admin integration tests passed: separate authentication,
  CSRF, financial conservation, concurrency/idempotency, overdraw prevention,
  merchant isolation, database guards, legacy exceptions, suspension, risk and audit.
- Live smoke passed, including first-admin concurrent setup (201/409), login/logout,
  capture/refund, settlement/payout, reconciliation and approval/suspension.
- Chromium browser passed checkout/refund, ledger entries, settlement/payout history,
  reconciliation, admin login/review/suspension/resume, transaction filters, risk,
  audit/logout and 390px finance/admin layouts without horizontal overflow.
- Seed preservation passed with newly created test fixtures: suspended status and
  all 28 payments remained unchanged across two reruns. Startup now checks public
  catalog readiness so deliberate suspension cannot prevent administrator access.
- Native Windows batch/PowerShell/browser opening remains outstanding.

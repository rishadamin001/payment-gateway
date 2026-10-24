# M2/M3 implementation and verification

Implemented on branch milestone/m2-m3-checkout-shop on 24 October 2026.

- Migration003 adds simulated checkout challenges and immutable order snapshots.
  Migrations001/002 are unchanged, preserving the applied checksum ledger.
- Hosted checkout supports card, bKash, Nagad, Rocket and bank simulations, fictional
  account labels, fake OTP000000, success/failure/cancel/expiry and DB-enforced transitions.
- Random checkout UUIDs act as capability links. Public responses omit merchant keys,
  contact details and arbitrary redirect URLs. Keep checkout links private.
- Payment row locking serializes confirmation/cancellation/expiry. Replays do not duplicate
  history. Practice steps expire after two minutes; five wrong codes lock that step.
- Actual payment expiry is enforced on checkout reads/actions and shop order reads,
  with browser polling. This is lazy expiry, not an unattended background scheduler.
- The shop prices validated cart items on the server, stores immutable line snapshots,
  and creates order/payment atomically. Idempotent concurrent Pay requests create one order.
  Receipts use payment state from PostgreSQL, never a URL's claimed success state.
- Windows start-demo.bat installs locked dependencies and starts both applications using
  an existing DATABASE_URL. A hidden PowerShell prompt supplies missing values in process
  memory only. No .env files are read/written and no real provider credentials are needed.

Executed in Linux cloud with Node24/PostgreSQL18:

| Check | Result |
| --- | --- |
| API build | Passed |
| Unit tests | 19 passed |
| PostgreSQL + HTTP integration tests | 161 passed (123 existing +38 M2/M3) |
| Web lint | Passed without warnings |
| Next production build | Passed |
| npm run verify with supplied DATABASE_URL and TEST_DATABASE_URL | Passed |
| Migration003 + existing seed rerun | Passed; seed added no duplicates |
| M1 smoke | Passed |
| M2/M3 smoke | All five methods, fake OTP, success/failure/cancel/expiry and receipts passed |
| Chromium browser | Shop/cart/checkout/receipts, five choices, all four outcomes, paid cart clearing, mobile width and no page errors passed |
| Existing-database launcher | windows-start.mjs exercised with supplied environment on Linux; apps ready |

Windows cmd.exe, PowerShell's hidden prompt, and browser auto-open cannot be executed
in this Linux workspace and remain unverified natively. No real payment processing,
external deployment or production merchant authentication is included. The original
M1 setup document's M2 exclusions describe that earlier milestone and are superseded here.

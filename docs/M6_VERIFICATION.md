# M6 — payment links and invoices

Cloud verification on 26 October 2026 (Asia/Dhaka). All activity is fictional.

- `npm run verify`: 32 unit tests and 191 integration tests passed, including
  authentication, merchant isolation, one-time concurrent checkouts, reusable
  idempotency, expiry, invoice totals/status/reminders and QR/PDF downloads.
- API/Next builds, web lint, additive migration007, repeatable seed, and live
  M1–M6 smoke checks passed against the existing development/test databases.
- A separate 11-test billing run passed after binding the test server once,
  avoiding listener warnings when issuing concurrent HTTP requests.
- Chromium browser checks passed: QR viewing/download, public checkout and return
  link, invoice line items/PDF download, overdue reminder, paid state, no page
  errors, and 390px layout without horizontal overflow.
- Native Windows batch/PowerShell/browser opening remains outstanding.

Payment links retain their amount, expiry and usage setting. A one-time link
shares its current pending checkout across concurrent requests; after success it
stays used even if refunded. Failed/cancelled attempts can be retried. Reusable
links allow multiple payments, with duplicate requests protected by idempotency.
Database guards enforce matching merchant/amount, expiry and one-time settlement.

Invoice totals are computed in integer paisa from up to30 line items. Drafts become
sent when their one-time payment link is created. Due dates determine the displayed
overdue state; actual successful payment marks an invoice paid. Reminders are
recorded only in-app. PDF documents identify themselves as fictional demo invoices;
the standard PDF font is intended for Latin-script demo names and descriptions.

Routes: merchant `/links`, `/links/:id/qr`, `/invoices`, `/invoices/:id`,
`/invoices/:id/send`, `/invoices/:id/remind`, `/invoices/:id/pdf` under
`/v1/merchant`; public `/v1/pay/:id` and `/v1/pay/:id/checkout` use shareable
link IDs. Mutation requests retain origin checks and scoped merchant sessions.
Public link pages expose no invoice customer email or account credentials.

QRs encode the configured checkout origin, defaulting to localhost:3001. They are
shareable between local tabs/profiles; another device needs a reachable deployment.
No LAN exposure or hosted deployment is configured by the Windows launcher.

# Complete product checklist

Keep the launcher running. Use fictional details and practice OTP **000000**.

- [ ] Shop: inspect all six product photos, add a product and see its Added button/cart notification, then remove products and change quantities. Pay with Card, bKash, Nagad, Rocket and Bank. Confirm normally for success. Use collapsed Classroom testing tools for a decline; cancel or wait two minutes for expiry. Watch each processing/result screen; inspect database-backed receipts.
- [ ] Merchant: create an account, load fictional examples, sign out/in. Reload examples to confirm no duplicate batch. Inspect charts, search, status/date filters and CSV export.
- [ ] Keys: generate a test key, copy from the one-time masked field, dismiss and revoke it. Live mode stays disabled. Keep keys off the projector.
- [ ] Payments: create a successful payment, open its timeline, issue a partial refund and then a full remaining refund. Inspect both histories.
- [ ] Webhooks: enable Fail twice, then accept before making a payment. See signed HTTP 503/503/200 deliveries. Test Always fail, wait about 35 seconds, switch to accept and manually retry.
- [ ] Links: create one-time/reusable links, open in another local tab, show/download QR, pay and inspect used status. Create a past-expiry example and confirm payment is blocked.
- [ ] Invoices: create two line items, download draft PDF, send in-app, add a reminder, inspect overdue status with a past due date. Pay its link and verify PAID. No email/SMS is sent.
- [ ] Finance: expand equal debit/credit entries, create a settlement, simulate payout, inspect history and reconciliation. New samples reconcile; unknown legacy partial refunds require review.
- [ ] Admin: choose a separate login on first use. Search and approve your merchant, suspend it and verify new payments are blocked, then resume. Inspect all transactions, risk flags and audit events.
- [ ] Architecture: explain browser → Next → Nest → PostgreSQL, atomic ledger/outbox updates and the local receiver.
- [ ] API docs: open API port 3000 /docs, inspect authentication, request/response schemas and binary downloads. Never project credentials.
- [ ] Windows: stop with Ctrl+C, restart start-demo.bat, verify retained records, hidden database prompt, downloads, automatic browser opening and clean shutdown. These native Windows behaviors remain outstanding.

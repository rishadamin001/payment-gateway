# Eight-minute MIS465 demonstration

Before class, run start-demo.bat, create merchant/admin accounts and load fictional examples. Open shop, merchant, finance, admin and architecture tabs. Keep all passwords/API keys off the projector.

| Time | Demonstration |
| --- | --- |
| 0:00–0:40 | Explain the merchant problem and state clearly: fake money, no real providers. |
| 0:40–1:40 | Shop cart → bKash → fake OTP 000000 → success. Point out cart feedback, product photos and Merchant dashboard access. Mention the optional Classroom testing tools for decline/expiry, plus Cancel payment. |
| 1:40–2:40 | Merchant charts, filters, CSV and timeline. Explain hashed passwords, separate sessions, test keys and idempotency. |
| 2:40–3:30 | Partial then remaining refund; inspect histories and explain atomic over-refund protection. |
| 3:30–4:15 | Signed webhook attempts and retries; show a delivered event and explain persisted outbox events. |
| 4:15–5:15 | Payment link/QR and invoice line items, PDF, overdue reminder and paid status. |
| 5:15–6:20 | Equal ledger debits/credits, simulated settlement/payout and reconciliation. Failed requests do not move balances. |
| 6:20–7:15 | Admin approval/suspension, risk hints and audit history. Risk flags are examples, not real fraud decisions. |
| 7:15–8:00 | Architecture and Swagger. Explain tests, additive migrations, preserved data and demo boundaries. |

If time is short, use seeded invoices and existing delivery logs. Install dependencies before class; the running demo uses local services only.

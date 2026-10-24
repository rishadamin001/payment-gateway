# M5 verified in cloud

24 October 2026 (Asia/Dhaka). Everything remains DEMO MODE, with no real money,
payment providers, cards, PINs, or OTPs. Work stops after M5.

## Executed checks

- `npm run verify` passed with the existing development database and separate
  existing `payment_gateway_test` database: **28 unit tests and 180 integration
  tests**, API/Next production builds, web lint, and live M1–M5 smoke suites.
- Migrations 005/006 applied successfully. Repeated startup recognized all six
  migrations without changes; the repeatable seed passed. No databases or records
  were dropped, truncated or reset. Fictional verification fixtures are retained.
- `node api/scripts/browser-m4.mjs` passed after M5: signup/login/logout, checkout,
  charts, search/filter/CSV, timeline, key creation/revocation and mobile width.
- `node api/scripts/browser-m5.mjs` passed in Chromium: signup, webhook settings,
  successful simulated card checkout, partial/full refunds, persisted timeline,
  two refund histories, six signed events with HTTP 503 → 503 → 200 retries,
  no application alerts/page errors, and 390px mobile layout.
- Existing-PostgreSQL cloud startup via `DATABASE_URL` passed. Windows launcher
  JavaScript syntax was checked; **native Windows batch execution, PowerShell hidden
  prompt and automatic browser opening remain outstanding** for the user.

## Behavior and limits

Refunds use integer paisa and a required reason. Omit the amount to refund the
remaining balance. The browser displays taka and retains the same idempotency key
when retrying an unchanged request. Payment locks and database triggers prevent
concurrent over-refunds; changed details with a reused key return HTTP 409. Each simulated
refund records REQUESTED → SUCCEEDED and updates the payment atomically. Refund
records and their history cannot be edited directly. Older partially refunded
payments without recorded amounts show unknown totals and reject further refunds;
their existing data remains intact. Dashboard revenue remains gross, before refunds.

Webhook settings are per merchant. The only destination is the built-in local demo
receiver; arbitrary external URLs are not supported. Database triggers write events
in the same transaction as payment creation/state changes/refunds. An enabled worker
claims persisted events with database leases and sends HMAC-SHA256 signatures over
`timestamp + '.' + exact raw JSON body`. The receiver uses constant-time comparison,
a five-minute timestamp window and event-ID deduplication. Signing keys remain
private on the server; settings and delivery logs never return them.

The receiver scenarios are accept, fail twice then accept, and always fail. Automatic
retries wait 2/4/8/16 seconds before stopping after five attempts. Manual retry opens
another batch; attempts retain their cumulative numbers. Pending events survive
restarts. Disabling webhooks pauses existing events and queues no new events. The
dashboard shows the latest 100 events and each attempt's response/signature result.
The launcher enables the worker automatically; standalone API startup requires
`PAYBD_WEBHOOK_WORKER=1`. No SMTP, provider credentials or extra Windows services
are required.

## M5 API routes

Merchant routes require the existing merchant session cookie. Mutating requests also
require an allowed Origin. The browser uses the same-origin `/api/merchant` proxy.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/merchant/payments/:id/refunds` | Scoped refund records, history and remaining balance |
| POST | `/v1/merchant/payments/:id/refunds` | Refund with `Idempotency-Key`, `reason`, optional `amount_paisa` |
| GET/POST | `/v1/merchant/webhooks` | Read/save `enabled` and `receiver_mode` |
| GET | `/v1/merchant/webhooks/events` | Scoped events and delivery attempts |
| POST | `/v1/merchant/webhooks/events/:id/retry` | Requeue an available failed/retry event |
| POST | `/v1/demo/webhook-receiver` | Built-in receiver; valid event/timestamp/HMAC required |

See [START_HERE.md](../START_HERE.md) for the Windows startup and presentation clicks.

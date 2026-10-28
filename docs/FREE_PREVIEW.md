# Free public demo preview

**No paid resources, card, hosting account or provider credentials are required.**
This option shares the running app through Tunnelmole's free random HTTPS URL.
The public URL is temporary: it stops working when the process or cloud workspace
stops, and a restart usually assigns a different URL. It is suitable for testing
and a live classroom demonstration. It is not permanent hosting.

## Current cloud status

On 28 October 2026, saving the environment's Internet-access setting took effect
in the running workspace even though the separate Publish operation reported an
error. The runtime reports the HTTP policy as enforced, and the relay WebSocket
connected through the configured proxy. A temporary public hostname was assigned;
its shop returned HTTP 200 and its health endpoint reported a connected database.
Publication of an environment snapshot and public preview connectivity are separate
operations. The Publish error's cause was not available in retained diagnostics.

For a restricted policy, the required destinations are:

- `service.tunnelmole.com` (secure WebSocket port 8083)
- `*.tunnelmole.net` (the generated public URL and verification)

After saving network settings, check the actual runtime policy and relay handshake.
Do not assume a Publish error means the network edit failed, or a successful save
means a public URL exists. No direct connection or policy bypass is used.

## Start after access is approved

Stop the demo application first. Keep the existing PostgreSQL service running and
supply DATABASE_URL only in the process environment, then run from the project root:

```text
npm run setup
npm run preview:free
```

The command builds both apps, requests a random public hostname, starts the hosted
launcher with that exact HTTPS origin and prints a URL only after application
readiness succeeds. The website/API, QR links and Swagger share that origin.
Ctrl+C stops the relay and apps while retaining the database. No migrations reset
or delete data. No new database is created by this command.

An administrator must already be initialized locally, or PAYBD_ADMIN_EMAIL and
PAYBD_ADMIN_PASSWORD must be supplied securely for first setup. Existing passwords
are preserved. Public first-administrator registration remains disabled. Create
your own fictional merchant account at `/merchant` to explore the dashboards.

## Demo boundaries and verification

Everything is fake money. Use fictional accounts/orders only. The relay provider
terminates the public HTTPS connection and carries browser request data, so do not
enter real financial details or reuse important passwords. The legacy sample
workspace is intentionally shared. Only an assigned `*.tunnelmole.net` hostname is
accepted. The relay adapter uses the configured HTTPS proxy and verifies TLS.
It forwards only to loopback port 10000, retains Origin for CSRF checks, rejects
ambiguous Host headers and normalizes forwarding metadata. It preserves PDF/QR
bytes and cookies, and bounds request sizes, response sizes, concurrency and time.

Local transport tests run with `node --test api/scripts/free-preview-transport.test.mjs`
and are included in `npm run verify`. These are not evidence of a working public
connection. After a URL is obtained, the agent must check health, merchant signup,
cart checkout, fake OTP, receipts, QR/PDF downloads and same-origin Swagger through
that public URL before reporting successful public deployment.

Cloud checks executed on 28 October 2026: 43 API unit tests, 211 integration tests,
two hosted-configuration tests and seven relay-transport tests passed. Both builds,
web lint and all M1–M8 live smoke suites passed. The local HTTPS browser test also
passed checkout/receipt, public URL configuration, Secure merchant/admin cookies,
blocked public admin setup and Swagger. Updating the Nest Express adapter patched
the reported Multer advisory; the production dependency audit reports zero known
vulnerabilities. The relay/proxy connection subsequently succeeded after the network policy changed.
The launcher was also tested to fail safely when access was denied.

This relay launcher currently targets the managed cloud workspace and requires its
configured HTTPS proxy. Windows users can continue using `start-demo.bat` locally;
native Windows relay operation is not claimed as verified.

The alternative `render.yaml` on branch `deployment/free-preview` now selects only
free plans for both services. Render still needs an account and platform validation;
free-plan availability, sleep and database retention are controlled by Render. Do
not accept any upgrade/payment prompt. The earlier paid Render template remains
in Git history; it is not the recommended option for this budget.

## Public verification after connection

The relay initially exposed a real forwarding defect: Node 24 fetch replaced the
public Host header with the loopback target, so the shop correctly rejected its
POST requests. The adapter now uses the Node HTTP client to retain the validated
public Host and browser Origin. Two additional real HTTP regression tests cover
headers, cookies, binary downloads, compressed responses, redirects and limits.
All nine transport tests and both hosted-config tests pass after this fix.

Live checks through the assigned public HTTPS URL passed all five simulated
checkout methods, totals, fake OTP, success/failure/cancel/expiry, receipts,
merchant signup and Secure cookies, sample dashboards, CSRF and admin-setup
protection, OpenAPI and eight page HTTP checks. Payment-link/QR/invoice/PDF/reminder
smoke checks also pass publicly. These checks add only fictional test fixtures.

Actual public browser automation remains unverified: Chromium rejected the managed
proxy's certificate, and an isolated Firefox test browser could not launch with its
new profile. TLS verification was kept enabled; existing browser trust/data was
not changed. The earlier local HTTPS browser checks are separate evidence. Native
Windows verification and the environment snapshot Publish failure remain outstanding.

The latest shop/cart/checkout visual update and its separate verification record
are documented in [SHOP_CHECKOUT_UPGRADE.md](SHOP_CHECKOUT_UPGRADE.md).

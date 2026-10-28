# Free public demo preview

**No paid resources, card, hosting account or provider credentials are required.**
This option shares the running app through Tunnelmole's free random HTTPS URL.
The public URL is temporary: it stops working when the process or cloud workspace
stops, and a restart usually assigns a different URL. It is suitable for testing
and a live classroom demonstration. It is not permanent hosting.

## Current cloud blocker

The app and local HTTPS browser checks pass, but the cloud workspace's enforced
proxy policy currently denies the relay connection. No public preview URL has
been created. A network configuration draft has been saved for exactly:

- `service.tunnelmole.com` (the relay uses secure WebSocket port 8083)
- `*.tunnelmole.net` (the generated public URL and its verification)

Review/save this network change in the cloud environment settings and publish the
environment configuration. Saving a draft alone does not activate permissions.
The agent must retry the proxy handshake afterward: the platform may still restrict
port 8083 or WebSocket upgrades. No direct connection or policy bypass is used.

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
vulnerabilities. The actual relay/proxy connection remains denied. The launcher
was tested to fail safely without starting a public session when access is denied.

This relay launcher currently targets the managed cloud workspace and requires its
configured HTTPS proxy. Windows users can continue using `start-demo.bat` locally;
native Windows relay operation is not claimed as verified.

The alternative `render.yaml` on branch `deployment/free-preview` now selects only
free plans for both services. Render still needs an account and platform validation;
free-plan availability, sleep and database retention are controlled by Render. Do
not accept any upgrade/payment prompt. The earlier paid Render template remains
in Git history; it is not the recommended option for this budget.

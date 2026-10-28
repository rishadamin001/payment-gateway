# Shop and checkout experience update

Everything remains DEMO MODE: fictional orders and money, no real provider,
financial credentials, SMS or bank connection. The visual direction uses navy,
blue and teal with clear merchant navigation, inspired by Bangladesh gateway
sites. PayBD is independent and does not claim provider affiliation.

## What changed

- All six catalogue products now have locally bundled photos, with cart and
  receipt thumbnails. Sources/licenses are in PRODUCT_IMAGES.md and the shop's
  Photo credits link. No external image requests are needed at runtime.
- Add to cart updates the button, animates the cart badge and announces a
  thumbnail/name/quantity notice with a View cart link. Quantity limits are
  visible. Cart persistence, server prices and idempotent ordering remain.
- Merchant dashboard is a prominent direct /merchant link on shop, checkout,
  receipts and the legacy workspace, including narrow screens.
- Normal checkout confirms the displayed fake code 000000 without asking a
  customer to choose a result. The demo server approves a valid confirmation.
  Optional decline and forced-expiry controls are collapsed under Classroom
  testing tools. They never contact any provider.
- Each payment method has its own styled processing transition, followed by a
  server-verified success, decline, cancellation or timeout screen. Receipts
  include the payment reference, amount and final state. Motion respects the
  operating system's reduced-motion preference.
- New payment requests last two minutes. Each fake OTP step lasts at most
  60 seconds, bounded by the payment deadline. If just the code expires, a new
  step can be opened while time remains. If the payment expires, the server
  records EXPIRED and checkout shows Payment timed out. It never pretends that
  a timed-out payment succeeded. This follows the authoritative state workflow.

## Data and compatibility

Migration 011 changes defaults for new rows only. Existing payment and challenge
deadlines, history, orders and merchant decisions remain untouched. New invoice
and payment-link checkout attempts use the same two-minute window; payment-link
share expiry is separate. The API still accepts explicit success/failure outcomes
for existing demo clients. Omitted outcome defaults to success. Confirmation,
expiry and retries remain row-locked and tested for concurrency.

Windows: start-demo.bat is unchanged. Use the same existing PostgreSQL DATABASE_URL
process environment or hidden prompt; no Docker or .env setup is introduced.
Native Windows verification remains outstanding. Cloud testing cannot establish
Windows launcher, browser-opening or download-permission behavior.

## Verification

Executed in the cloud on 28 October 2026 (Asia/Dhaka):

- npm run verify passed: 43 API unit, 221 integration, two hosted configuration
  and nine relay tests (275 total), API/Next builds, web lint, migrations/seeds
  and all M1–M8 live smoke suites.
- Existing M4, M5, M6, M7 and M8 Chromium browser suites passed after the change.
- The final production web build and lint passed after the mobile layout fix.
  The local hosted HTTPS browser suite also passed checkout/receipt, Secure
  merchant/admin cookies, blocked public admin setup, Swagger and health.
- The dedicated browser-shop-experience.mjs suite passed with exit 0 after
  fixing a mobile decorative-circle overflow. It verifies photos, cart notices,
  quantities, mobile navigation, all five method transitions, normal approval,
  instructor decline, cancellation, real two-minute expiry and reduced motion.

Live public HTTPS checks also passed all six image files, the two-minute payment
window, the one-minute code window, default server approval without an outcome
field, persisted receipt and updated OpenAPI. Public browser automation remains
unverified because of the cloud proxy certificate limitation described below.

Run the dedicated suite with the local demo running:

```text
node api/scripts/browser-shop-experience.mjs
```

For a temporary public preview, follow FREE_PREVIEW.md. The URL changes whenever
the relay restarts. Actual public browser automation still depends on the cloud
browser trusting the platform proxy CA; no TLS verification is disabled to force
it to pass. Local browser and public API results are reported separately.

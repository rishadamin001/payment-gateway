# PayBD Demo — start here (Windows)

**DEMO MODE: no real money.** Every card, bKash, Nagad, Rocket, bank account and OTP is simulated. Never enter real payment details.

## Exactly what to run

1. Install **Node.js 24** and make sure your existing **PostgreSQL** service is running. Keep your existing `payment_gateway` database. You do **not** need Docker.
2. Extract this ZIP into a **new folder** (not over your existing project). Open the extracted `PayBD_M1_M5` folder.
3. **Double-click `start-demo.bat`.** It uses `DATABASE_URL` if already set in its environment. Otherwise a hidden prompt asks for it. Enter your PostgreSQL connection URL in this format, substituting your own username/password:
   `postgresql://USER:PASSWORD@localhost:5432/payment_gateway`
   The value is not displayed, saved to a file, or committed. URL-encode special characters in the password (for example `@` becomes `%40`). No `.env` file is needed or read.
4. Wait for **“PayBD Demo ready”**. The launcher installs locked dependencies, applies additive migrations, seeds fictional examples, and starts both apps. The first start needs Internet access. Keep the terminal open.
5. Your browser opens the shop. If it does not, enter **localhost:3001/shop** in your browser. Your merchant dashboard is **localhost:3001/merchant**; **localhost:3001** shows the public fictional examples.

Already have `DATABASE_URL` in a PowerShell environment? Run `./start-demo.bat` in that same window. It will not prompt again. Do not paste connection credentials into chat, source files or commands that are saved to shared logs.

## Try the complete flow

Add products to the cart → **Pay** → choose **Card, bKash, Nagad, Rocket or Bank** → request the fake OTP → enter the practice code **000000** shown on screen → choose a simulated success or failure. No SMS is sent. **Cancel** and **Expire demo payment** demonstrate the other terminal results. The shop result page reads the actual database state; changing a URL cannot make a payment paid. Retry after a failure/cancellation/expiry creates a new payment. The merchant dashboard shows state history.

## Stop or check it

Press **Ctrl+C** in the launcher terminal to stop the apps. Your existing database and all records remain. Start the same batch file again to resume; seeds do not duplicate records.

For the full automated suite, stop the demo, create a separate empty PostgreSQL database named `payment_gateway_test`, and provide its connection as `TEST_DATABASE_URL` in your process environment alongside `DATABASE_URL`. From the extracted folder run:

```text
npm run verify
```

Normal demo startup does not need a test database. Tests add isolated fictional fixtures without dropping databases. If startup fails: check PostgreSQL is running, the URL names an existing database, and ports **3000/3001** are free. The launcher will not stop unrelated services or erase data. No real provider credentials are needed.

## M4 merchant dashboard

Open **localhost:3001/merchant**, choose **Create an account**, and use a fictional email
and a new demo-only password of at least 12 characters. No preset password is needed.
Click **Create demo payment**, finish the simulated checkout, then return to Merchant
Dashboard to filter transactions, export CSV, inspect charts, or open a payment timeline.
The API keys panel creates/revokes test keys; live mode is disabled. Test keys are shown
once in a masked field for copying. Never send passwords or keys to chat or source files.

## M5 refunds and signed webhooks

In your merchant dashboard, click **Webhooks** → enable webhooks → choose **Fail twice,
then accept** → **Save settings**. Return to the dashboard, click **Create demo payment**,
and finish a successful simulated checkout. Open that payment from your transaction list.
Under **Simulated refunds**, enter a smaller taka amount and a reason, then click
**Confirm demo refund**. Leave the amount blank on a second refund to return the rest.
The payment timeline shows **PAID → PARTIALLY_REFUNDED → REFUNDED**, with a separate
refund history. Open **Webhooks** again to see signed deliveries retry and succeed.

Webhooks use the built-in local receiver only. To demonstrate exhausted retries,
choose **Always fail**, create another payment, and wait about 35 seconds. Then switch
to **Accept every delivery** and click **Retry event**. No external service or money
is involved. Older partially refunded examples without recorded amounts cannot be
refunded again. Cloud builds, tests and browser checks are documented in
`docs/M5_VERIFICATION.md`; native Windows verification remains for you to run.

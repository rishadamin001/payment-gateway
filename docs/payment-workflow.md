# Payment workflow

## Payment states

- PENDING: the merchant created the payment and the customer has not finished paying yet.
- PAID: the customer's payment was confirmed. This is final, apart from refunds.
- FAILED: the payment was declined or an error occurred. The customer may try again with a new payment.
- CANCELLED: the customer clicked cancel on the checkout page.
- EXPIRED: the customer never finished paying within the time limit (2 minutes for new demo requests; existing request deadlines are preserved).
- REFUNDED: all of the money was returned to the customer.
- PARTIALLY_REFUNDED: some of the money was returned.

## Allowed changes

- PENDING can become PAID, FAILED, CANCELLED or EXPIRED.
- PAID can become REFUNDED or PARTIALLY_REFUNDED.
- PARTIALLY_REFUNDED can become REFUNDED.
- FAILED, CANCELLED, EXPIRED and REFUNDED are final. Nothing changes after them.

## The normal journey

1. The merchant's website asks our API to create a payment (amount, order number, success and cancel links).
2. We save it as PENDING and send back a checkout link.
3. The customer opens the checkout page and pays (in the test version, a fake payment simulator).
4. The payment provider tells us the result.
5. We update the state and save a record of it.
6. We notify the merchant's website, and redirect the customer to the success or cancel page.

## Rules we never break

- Money amounts are whole numbers in paisa (150000 means 1,500 taka), never decimals.
- Each payment request carries a unique Idempotency-Key. If the same request arrives twice, we return the first result and never create a second payment.
- A payment moves only along the allowed changes above, never backwards.
- Every state change is saved with its time, so we can always explain what happened.
- We never store real card numbers, PINs or OTPs.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type SampleCounts = {
  payments: number;
  refunds: number;
  links: number;
  invoices: number;
  settlements: number;
  payouts: number;
};
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const day = 86400000;
const notice =
  'DEMO MODE: fictional classroom examples only. No real money or providers.';

/** Shared by the authenticated demo-data action and the additive startup seed. */
export async function seedMerchantSamples(
  pool: Pool,
  merchantId: string,
  origin = 'http://localhost:3001',
) {
  const db = await pool.connect();
  const counts: SampleCounts = {
    payments: 0,
    refunds: 0,
    links: 0,
    invoices: 0,
    settlements: 0,
    payouts: 0,
  };
  try {
    await db.query('BEGIN');
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,465008))',
      [merchantId],
    );
    const merchant = (
      await db.query('SELECT id,status FROM merchants WHERE id=$1 FOR UPDATE', [
        merchantId,
      ])
    ).rows[0];
    if (!merchant || merchant.status !== 'ACTIVE') {
      await db.query('COMMIT');
      return { created: false, skipped: true, counts, test_mode: true, notice };
    }
    const previous = (
      await db.query(
        'SELECT counts FROM demo_sample_batches WHERE merchant_id=$1',
        [merchantId],
      )
    ).rows[0];
    if (previous) {
      await db.query('COMMIT');
      return {
        created: false,
        counts: previous.counts as SampleCounts,
        test_mode: true,
        notice,
      };
    }
    const batch = randomUUID();
    const key = (suffix: string) => `m8:${batch}:${suffix}`;
    const now = Date.now();
    // Respect any existing settings, including a deliberate pause or failure scenario.
    await db.query(
      `INSERT INTO merchant_webhooks(merchant_id,enabled,receiver_mode,signing_secret)
      VALUES($1,true,'success',$2) ON CONFLICT(merchant_id) DO NOTHING`,
      [merchantId, randomBytes(32).toString('hex')],
    );

    async function payment(
      label: string,
      amount: number,
      state: string,
      ageDays: number,
      linkId: string | null = null,
    ) {
      const created = new Date(
        now - (state === 'PENDING' || linkId ? 60000 : ageDays * day),
      );
      const expires = new Date(created.getTime() + 30 * 60000);
      const suffix = counts.payments + 1;
      const redirect = new URL(
        linkId ? `/pay/${linkId}` : '/merchant',
        origin,
      ).toString();
      const row = (
        await db.query(
          `INSERT INTO payments(merchant_id,merchant_order_id,amount_paisa,currency,status,
        success_url,cancel_url,idempotency_key,request_fingerprint,created_at,updated_at,expires_at,payment_link_id)
        VALUES($1,$2,$3,'BDT','PENDING',$4,$4,$5,$6,$7,$7,$8,$9) RETURNING id`,
          [
            merchantId,
            `SAMPLE-${String(suffix).padStart(2, '0')}-${label}`,
            amount,
            redirect,
            key(`payment-${suffix}`),
            digest(`${batch}:${suffix}:${amount}`),
            created,
            expires,
            linkId,
          ],
        )
      ).rows[0];
      counts.payments++;
      if (state !== 'PENDING') {
        const first = ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(state)
          ? 'PAID'
          : state;
        await db.query('UPDATE payments SET status=$1 WHERE id=$2', [
          first,
          row.id,
        ]);
        if (['PAID', 'FAILED'].includes(first)) {
          await db.query(
            `INSERT INTO checkout_challenges(payment_id,method,created_at,expires_at,completed_at,completed_outcome)
            VALUES($1,$2,$3,$4,$5,$6)`,
            [
              row.id,
              ['card', 'bkash', 'nagad', 'rocket', 'bank'][suffix % 5],
              created,
              new Date(created.getTime() + 120000),
              new Date(created.getTime() + 30000),
              first === 'PAID' ? 'success' : 'failure',
            ],
          );
        }
        if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(state)) {
          const refundAmount =
            state === 'REFUNDED' ? amount : Math.floor(amount / 4);
          await db.query(
            `INSERT INTO payment_refunds(payment_id,merchant_id,amount_paisa,reason,idempotency_key,request_fingerprint)
            VALUES($1,$2,$3,$4,$5,$6)`,
            [
              row.id,
              merchantId,
              refundAmount,
              state === 'REFUNDED'
                ? 'Fictional full return: duplicate gift order'
                : 'Fictional partial return: one item returned',
              key(`refund-${suffix}`),
              digest(`${batch}:refund:${suffix}:${refundAmount}`),
            ],
          );
          counts.refunds++;
        }
      }
      return row.id as string;
    }
    const examples: [string, number, string, number][] = [
      ['JUTE-TOTE', 185000, 'PAID', 14],
      ['DESK-SET', 265000, 'PAID', 13],
      ['BOOK-BUNDLE', 125000, 'PAID', 12],
      ['CERAMIC-MUGS', 320000, 'PAID', 11],
      ['COTTON-SCARF', 155000, 'CANCELLED', 10],
      ['BAMBOO-LAMP', 485000, 'PAID', 9],
      ['GIFT-HAMPER', 650000, 'PARTIALLY_REFUNDED', 8],
      ['NOTEBOOKS', 89000, 'PAID', 7],
      ['WOVEN-RUG', 950000, 'PAID', 6],
      ['PLANTER-SET', 275000, 'REFUNDED', 5],
      ['ART-PRINT', 225000, 'EXPIRED', 4],
      ['TEA-SAMPLER', 135000, 'PAID', 3],
      ['DESK-ORGANIZER', 175000, 'PAID', 2],
      ['LINEN-BAG', 245000, 'PARTIALLY_REFUNDED', 1],
      ['CORPORATE-GIFTS', 12500000, 'PAID', 0.3],
      ['PRACTICE-DECLINE-A', 120000, 'FAILED', 0.1],
      ['PRACTICE-DECLINE-B', 165000, 'FAILED', 0.08],
      ['PRACTICE-DECLINE-C', 99000, 'FAILED', 0.05],
      ['PENDING-GIFT', 375000, 'PENDING', 0],
      ['PENDING-NOTEBOOK', 85000, 'PENDING', 0],
      ['TRAVEL-POUCH', 145000, 'PAID', 0.04],
      ['HOME-DECOR', 580000, 'PAID', 0.03],
      ['WRONG-SIZE-RETURN', 210000, 'REFUNDED', 0.02],
      ['PRACTICE-CANCEL', 75000, 'CANCELLED', 0.01],
    ];
    for (const [label, amount, state, age] of examples)
      await payment(label, amount, state, age);

    async function link(
      title: string,
      amount: number,
      reusable: boolean,
      expires: Date,
    ) {
      const row = (
        await db.query(
          `INSERT INTO payment_links(merchant_id,title,amount_paisa,reusable,expires_at)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [merchantId, title, amount, reusable, expires],
        )
      ).rows[0];
      counts.links++;
      return row.id as string;
    }
    await link(
      'Fictional artisan gift box',
      249000,
      false,
      new Date(now + 30 * day),
    );
    await link(
      'Reusable classroom workshop ticket',
      65000,
      true,
      new Date(now + 60 * day),
    );
    await link(
      'Expired festival offer (demo)',
      199000,
      false,
      new Date(now - day),
    );
    const paidLink = await link(
      'Paid sample gift voucher',
      150000,
      false,
      new Date(now + 30 * day),
    );
    await payment('PAID-LINK', 150000, 'PAID', 0, paidLink);

    const invoiceKinds = ['DRAFT', 'SENT', 'PAID', 'OVERDUE'];
    const customers = [
      'Nadia Demo',
      'Farhan Example',
      'Mina Classroom',
      'Rafi Fictional',
    ];
    for (let i = 0; i < invoiceKinds.length; i++) {
      const items = [
        {
          description: 'Fictional handmade notebook',
          quantity: 3,
          unit_amount_paisa: 45000,
        },
        {
          description: 'Demo gift wrapping',
          quantity: 1,
          unit_amount_paisa: 15000,
        },
      ];
      const due = new Date(
        now + (invoiceKinds[i] === 'OVERDUE' ? -7 : 14) * day,
      );
      const inv = (
        await db.query(
          `INSERT INTO invoices(merchant_id,customer_name,customer_email,due_at,items,amount_paisa)
        VALUES($1,$2,$3,$4,$5::jsonb,150000) RETURNING id`,
          [
            merchantId,
            customers[i],
            `customer-${i + 1}@paybd.example.test`,
            due,
            JSON.stringify(items),
          ],
        )
      ).rows[0];
      counts.invoices++;
      if (invoiceKinds[i] === 'DRAFT') continue;
      const linkId = await link(
        `Sample invoice for ${customers[i]}`,
        150000,
        false,
        new Date(now + 365 * day),
      );
      await db.query(
        "UPDATE invoices SET status='SENT',link_id=$1,sent_at=now() WHERE id=$2",
        [linkId, inv.id],
      );
      if (invoiceKinds[i] === 'PAID')
        await payment('PAID-INVOICE', 150000, 'PAID', 0, linkId);
      if (invoiceKinds[i] === 'OVERDUE')
        await db.query(
          `INSERT INTO invoice_reminders(invoice_id,message)
        VALUES($1,'Fictional in-app reminder: please try the simulated checkout. No email or SMS was sent.')`,
          [inv.id],
        );
    }
    // Existing merchants may contain legacy partial refunds with unknown amounts.
    // Preserve that exception and avoid inventing a withdrawable balance for them.
    const financial = (
      await db.query(
        "SELECT paybd_unknown_refunds($1)::int unknown,paybd_finance_balance($1,'MERCHANT_PAYABLE')::float8 available,-paybd_finance_balance($1,'CLEARING')::float8 clearing",
        [merchantId],
      )
    ).rows[0];
    if (
      !financial.unknown &&
      financial.available >= 150000 &&
      financial.clearing >= 100000
    ) {
      for (let i = 0; i < 2; i++) {
        const amount = i === 0 ? 100000 : 50000;
        const settlement = (
          await db.query(
            `INSERT INTO simulated_settlements(merchant_id,amount_paisa,idempotency_key,request_fingerprint)
          VALUES($1,$2,$3,$4) RETURNING id`,
            [
              merchantId,
              amount,
              key(`settlement-${i}`),
              digest(`${batch}:settlement:${i}`),
            ],
          )
        ).rows[0];
        counts.settlements++;
        if (i === 0) {
          await db.query(
            `INSERT INTO simulated_payouts(settlement_id,merchant_id,amount_paisa,idempotency_key,request_fingerprint)
            VALUES($1,$2,$3,$4,$5)`,
            [
              settlement.id,
              merchantId,
              amount,
              key('payout'),
              digest(`${batch}:payout`),
            ],
          );
          counts.payouts++;
        }
      }
    }
    await db.query(
      'INSERT INTO demo_sample_batches(merchant_id,id,counts) VALUES($1,$2,$3::jsonb)',
      [merchantId, batch, JSON.stringify(counts)],
    );
    await db.query('COMMIT');
    return { created: true, counts, test_mode: true, notice };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

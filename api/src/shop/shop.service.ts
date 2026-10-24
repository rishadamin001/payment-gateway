import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { PaymentsService } from '../payments/payments.service.js';
import { checkoutBaseUrl, DEMO_NOTICE, fingerprintPayment, formatBDT, validateIdempotencyKey, type PaymentStatus } from '../payments/payment-utils.js';
import { normalizeCart, SHOP_PRODUCTS, type ShopItem } from './shop-catalog.js';

type OrderRow = {
  id: string;
  amount_paisa: string;
  currency: 'BDT';
  status: PaymentStatus;
  items: ShopItem[];
  request_fingerprint: string;
  created_at: Date;
  expires_at: Date;
};

@Injectable()
export class ShopService {
  private readonly checkoutOrigin = checkoutBaseUrl(process.env.PAYBD_CHECKOUT_BASE_URL);
  constructor(private readonly payments: PaymentsService) {}

  catalog() {
    return { products: SHOP_PRODUCTS, notice: DEMO_NOTICE, test_mode: true };
  }

  private present(row: OrderRow) {
    const amount = Number(row.amount_paisa);
    return {
      id: row.id,
      payment_id: row.id,
      checkout_url: new URL(`/checkout/${row.id}`, this.checkoutOrigin).toString(),
      amount_paisa: amount,
      amount_display: formatBDT(amount),
      currency: row.currency,
      status: row.status,
      items: row.items,
      created_at: row.created_at,
      expires_at: row.expires_at,
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }

  private async findOrder(client: PoolClient, id: string, merchantId: string): Promise<OrderRow> {
    const result = await client.query<OrderRow>(
      `SELECT p.id, p.amount_paisa::text AS amount_paisa, p.currency, p.status,
        o.items, o.request_fingerprint, p.created_at, p.expires_at
       FROM public.shop_orders o JOIN public.payments p ON p.id = o.id
       WHERE o.id = $1::uuid AND o.merchant_id = $2::uuid AND p.merchant_id = $2::uuid
       FOR UPDATE OF p`, [id, merchantId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Demo shop order not found');
    const expired = await client.query(
      `UPDATE public.payments SET status = 'EXPIRED'
       WHERE id = $1::uuid AND status = 'PENDING' AND expires_at <= clock_timestamp() RETURNING id`, [id],
    );
    if (expired.rowCount) row.status = 'EXPIRED';
    return row;
  }

  async createOrder(authorization: string | undefined, header: string | undefined, body: unknown) {
    const merchant = await this.payments.authenticate(authorization);
    const key = validateIdempotencyKey(header);
    const items = normalizeCart(body);
    const fingerprint = createHash('sha256').update(JSON.stringify(items.map(item => ({ product_id: item.product_id, quantity: item.quantity })))).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize shop requests before creating either row. The payment unique
      // constraint also protects collisions with simultaneous M1 API requests.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${merchant.id}:${key}`]);
      const previous = await client.query<{ id: string }>(
        'SELECT id FROM public.payments WHERE merchant_id = $1::uuid AND idempotency_key = $2', [merchant.id, key],
      );
      let row: OrderRow;
      if (previous.rows[0]) {
        row = await this.replay(client, previous.rows[0].id, merchant.id, fingerprint);
      } else {
        const id = randomUUID();
        const input = {
          amount_paisa: items.reduce((total, item) => total + item.line_total_paisa, 0),
          currency: 'BDT' as const,
          merchant_order_id: `SHOP-${id}`,
          success_url: new URL(`/shop/result/${id}`, this.checkoutOrigin).toString(),
          cancel_url: new URL(`/shop/result/${id}`, this.checkoutOrigin).toString(),
        };
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO public.payments
           (id, merchant_id, merchant_order_id, amount_paisa, currency, status, success_url, cancel_url, idempotency_key, request_fingerprint)
           VALUES ($1,$2,$3,$4,'BDT','PENDING',$5,$6,$7,$8)
           ON CONFLICT (merchant_id, idempotency_key) DO NOTHING RETURNING id`,
          [id, merchant.id, input.merchant_order_id, input.amount_paisa, input.success_url, input.cancel_url, key, fingerprintPayment(input)],
        );
        if (!inserted.rows[0]) {
          // A concurrent request to the original payment API won the unique key.
          throw new ConflictException('This Idempotency-Key belongs to another payment request');
        }
        await client.query(
          `INSERT INTO public.shop_orders (id, merchant_id, items, request_fingerprint)
           VALUES ($1,$2,$3::jsonb,$4)`, [id, merchant.id, JSON.stringify(items), fingerprint],
        );
        row = await this.findOrder(client, id, merchant.id);
      }
      await client.query('COMMIT');
      return this.present(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async replay(client: PoolClient, id: string, merchantId: string, fingerprint: string) {
    const exists = await client.query<{ request_fingerprint: string }>(
      'SELECT request_fingerprint FROM public.shop_orders WHERE id = $1::uuid AND merchant_id = $2::uuid', [id, merchantId],
    );
    if (!exists.rows[0] || exists.rows[0].request_fingerprint !== fingerprint) {
      throw new ConflictException('This Idempotency-Key was already used with different order details');
    }
    return this.findOrder(client, id, merchantId);
  }

  async getOrder(authorization: string | undefined, id: string) {
    const merchant = await this.payments.authenticate(authorization);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) throw new BadRequestException('Invalid order ID');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.findOrder(client, id, merchant.id);
      await client.query('COMMIT');
      return this.present(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

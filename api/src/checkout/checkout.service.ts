import {
  BadRequestException, ConflictException, HttpException, HttpStatus,
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { DEMO_NOTICE, formatBDT, type PaymentStatus } from '../payments/payment-utils.js';

const methods = ['card', 'bkash', 'nagad', 'rocket', 'bank'] as const;
type Method = typeof methods[number];
type CheckoutPayment = {
  id: string; merchant_order_id: string; business_name: string; merchant_status: string;
  amount_paisa: string; currency: string; status: PaymentStatus;
  expires_at: Date; shop_order_id: string | null; payment_link_id: string | null; database_now: Date;
};
type Challenge = {
  id: string; method: Method; attempts: number; expires_at: Date;
  superseded_at: Date | null; completed_at: Date | null;
  completed_outcome: 'success' | 'failure' | null;
};

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}
function object(body: unknown, fields: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !fields.includes(key))) {
    throw new BadRequestException('Only the documented simulated checkout fields are accepted');
  }
  return body as Record<string, unknown>;
}

@Injectable()
export class CheckoutService {
  // The random checkout UUID is a capability link. Expose only receipt fields;
  // merchant API keys, contact details and arbitrary redirect URLs never leave here.
  private async transaction<T>(work: (client: PoolClient) => Promise<T | HttpException>): Promise<T> {
    const client = await pool.connect();
    let result: T | HttpException;
    try {
      await client.query('BEGIN');
      result = await work(client);
      // Expected rejected attempts and natural expiry must persist. They return
      // an exception value; unexpected failures throw and roll back atomically.
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    if (result instanceof HttpException) throw result;
    return result;
  }

  private async lock(client: PoolClient, id: string): Promise<CheckoutPayment> {
    if (!uuid(id)) throw new BadRequestException('Invalid checkout ID');
    const result = await client.query<CheckoutPayment>(`SELECT p.id, p.merchant_order_id,
      m.business_name, m.status AS merchant_status, p.amount_paisa::text, p.currency, p.status, p.expires_at,
      o.id AS shop_order_id, p.payment_link_id, clock_timestamp() AS database_now
      FROM public.payments p JOIN public.merchants m ON m.id = p.merchant_id
      LEFT JOIN public.shop_orders o ON o.id = p.id
      WHERE p.id = $1::uuid FOR UPDATE OF p`, [id]);
    const payment = result.rows[0];
    if (!payment) throw new NotFoundException('Checkout not found');
    // Read after acquiring the row lock: a competing request may have held it
    // across the deadline. Database time is the authority, not browser time.
    const time = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    payment.database_now = time.rows[0].now;
    if (payment.status === 'PENDING' && payment.expires_at <= payment.database_now) {
      await client.query("UPDATE public.payments SET status = 'EXPIRED' WHERE id = $1", [id]);
      payment.status = 'EXPIRED';
    }
    return payment;
  }

  private async present(client: PoolClient, payment: CheckoutPayment) {
    const method = await client.query<{ method: Method }>(`SELECT method FROM public.checkout_challenges
      WHERE payment_id = $1 ORDER BY completed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1`, [payment.id]);
    return {
      id: payment.id, merchant_name: payment.business_name,
      merchant_order_id: payment.merchant_order_id,
      amount_paisa: Number(payment.amount_paisa), amount_display: formatBDT(Number(payment.amount_paisa)),
      currency: payment.currency, status: payment.status, expires_at: payment.expires_at,
      server_time: payment.database_now, shop_order_id: payment.shop_order_id, payment_link_id: payment.payment_link_id,
      method: method.rows[0]?.method ?? null, notice: DEMO_NOTICE, test_mode: true,
    };
  }

  async get(id: string) {
    return this.transaction(async client => this.present(client, await this.lock(client, id)));
  }

  async challenge(id: string, body: unknown) {
    const input = object(body, ['method']);
    if (typeof input.method !== 'string' || !methods.includes(input.method as Method)) {
      throw new BadRequestException('Choose card, bkash, nagad, rocket or bank in demo mode');
    }
    return this.transaction(async client => {
      const payment = await this.lock(client, id);
      if (payment.merchant_status !== 'ACTIVE') return new ForbiddenException('This merchant cannot accept simulated payments');
      if (payment.status !== 'PENDING') return new ConflictException('This payment is already final; refresh its result');
      await client.query(`UPDATE public.checkout_challenges SET superseded_at = clock_timestamp()
        WHERE payment_id = $1 AND superseded_at IS NULL AND completed_at IS NULL`, [id]);
      const result = await client.query<{ id: string; expires_at: Date }>(`INSERT INTO public.checkout_challenges
        (payment_id, method, expires_at) VALUES ($1, $2, LEAST($3::timestamptz, clock_timestamp() + interval '60 seconds'))
        RETURNING id, expires_at`, [id, input.method, payment.expires_at]);
      return { challenge_id: result.rows[0].id, method: input.method, fake_code: '000000',
        expires_at: result.rows[0].expires_at, notice: DEMO_NOTICE, test_mode: true };
    });
  }

  async confirm(id: string, body: unknown) {
    const input = object(body, ['challenge_id', 'code', 'outcome']);
    // Customer checkout uses a server-selected approval. Explicit outcomes remain
    // available to the optional classroom scenario tools and older API clients.
    const outcome = input.outcome === undefined ? 'success' : input.outcome;
    if (!uuid(input.challenge_id) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code) ||
        (typeof outcome !== 'string' || !['success', 'failure'].includes(outcome))) {
      throw new BadRequestException('Provide a challenge ID and six-digit fake code; an optional outcome must be success or failure');
    }
    return this.transaction(async client => {
      const payment = await this.lock(client, id);
      const result = await client.query<Challenge>(`SELECT id, method, attempts, expires_at,
        superseded_at, completed_at, completed_outcome FROM public.checkout_challenges
        WHERE id = $1::uuid AND payment_id = $2::uuid`, [input.challenge_id, id]);
      const challenge = result.rows[0];
      if (!challenge || challenge.superseded_at) return new ConflictException('This fake verification step is no longer active');
      if (challenge.completed_at) {
        if (challenge.completed_outcome !== outcome || input.code !== '000000') {
          return new ConflictException('This fake verification already completed with another result');
        }
        return this.present(client, payment);
      }
      if (payment.merchant_status !== 'ACTIVE') return new ForbiddenException('This merchant cannot accept simulated payments');
      if (payment.status !== 'PENDING') return new ConflictException('This payment is already final; refresh its result');
      if (challenge.expires_at <= payment.database_now) return new ConflictException('The fake verification step expired; start a new step');
      if (challenge.attempts >= 5) return new HttpException('Fake verification attempt limit reached; start a new step', HttpStatus.TOO_MANY_REQUESTS);
      // The only accepted code is an advertised simulation value. Never persist,
      // log or send entered codes to providers; only an attempt count is retained.
      if (input.code !== '000000') {
        await client.query('UPDATE public.checkout_challenges SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
        return new BadRequestException('Use the displayed fake code 000000. Do not enter a real OTP');
      }
      const status = outcome === 'success' ? 'PAID' : 'FAILED';
      await client.query('UPDATE public.payments SET status = $1 WHERE id = $2', [status, id]);
      await client.query(`UPDATE public.checkout_challenges
        SET completed_at = clock_timestamp(), completed_outcome = $1 WHERE id = $2`, [outcome, challenge.id]);
      payment.status = status;
      return this.present(client, payment);
    });
  }

  async finish(id: string, body: unknown, status: 'CANCELLED' | 'EXPIRED') {
    object(body ?? {}, []);
    return this.transaction(async client => {
      const payment = await this.lock(client, id);
      if (payment.status === status) return this.present(client, payment);
      if (payment.status !== 'PENDING') return new ConflictException('A final payment result cannot be changed');
      await client.query('UPDATE public.payments SET status = $1 WHERE id = $2', [status, id]);
      payment.status = status;
      return this.present(client, payment);
    });
  }
}

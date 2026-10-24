import { createHash } from 'node:crypto';
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { pool } from '../db.js';
import {
  DEMO_NOTICE, checkoutBaseUrl, fingerprintPayment, formatBDT,
  validateIdempotencyKey, validateNewPayment,
  type PaymentStatus,
} from './payment-utils.js';

type Merchant = { id: string; business_name: string; status: string };
type PaymentRow = {
  id: string;
  merchant_id: string;
  merchant_order_id: string;
  amount_paisa: string;
  currency: 'BDT';
  status: PaymentStatus;
  success_url: string;
  cancel_url: string;
  request_fingerprint: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  history?: Array<{
    id: string;
    from_status: PaymentStatus | null;
    to_status: PaymentStatus;
    reason: string;
    changed_at: string;
  }>;
};

@Injectable()
export class PaymentsService {
  private readonly checkoutOrigin = checkoutBaseUrl(process.env.PAYBD_CHECKOUT_BASE_URL);
  private readonly columns = `p.id, p.merchant_id, p.merchant_order_id, p.amount_paisa::text AS amount_paisa,
    p.currency, p.status, p.success_url, p.cancel_url, p.request_fingerprint,
    p.created_at, p.updated_at, p.expires_at`;

  private async authenticate(authorization: string | undefined): Promise<Merchant> {
    const match = authorization?.match(/^Bearer (paybd_test_[A-Za-z0-9_-]{43})$/);
    if (!match) {
      throw new UnauthorizedException('A valid PayBD Demo test API key is required');
    }
    const hash = createHash('sha256').update(match[1]).digest('hex');
    const result = await pool.query<Merchant>(
      `SELECT m.id, m.business_name, m.status FROM public.merchant_api_keys k
       JOIN public.merchants m ON m.id = k.merchant_id
       WHERE k.key_hash = $1 AND k.mode = 'TEST' AND k.revoked_at IS NULL`,
      [hash],
    );
    const merchant = result.rows[0];
    if (!merchant) throw new UnauthorizedException('Invalid or revoked test API key');
    if (merchant.status !== 'ACTIVE') {
      throw new ForbiddenException('Merchant is not approved for simulated payments');
    }
    return merchant;
  }

  private async findPayment(id: string, merchantId: string): Promise<PaymentRow> {
    const result = await pool.query<PaymentRow>(
      `SELECT ${this.columns},
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', h.id::text, 'from_status', h.from_status, 'to_status', h.to_status,
           'reason', h.reason, 'changed_at', h.changed_at
         ) ORDER BY h.id), '[]'::jsonb)
         FROM public.payment_status_history h WHERE h.payment_id = p.id) AS history
       FROM public.payments p WHERE p.id = $1::uuid AND p.merchant_id = $2::uuid`,
      [id, merchantId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Payment not found');
    return row;
  }

  private present(row: PaymentRow, originalCreation = false) {
    const paisa = Number(row.amount_paisa);
    return {
      id: row.id,
      merchant_id: row.merchant_id,
      merchant_order_id: row.merchant_order_id,
      amount_paisa: paisa,
      amount_display: formatBDT(paisa),
      currency: row.currency,
      status: originalCreation ? 'PENDING' : row.status,
      checkout_url: new URL(
        `/checkout/${row.id}`,
        this.checkoutOrigin,
      ).toString(),
      success_url: row.success_url,
      cancel_url: row.cancel_url,
      created_at: row.created_at,
      updated_at: originalCreation ? row.created_at : row.updated_at,
      expires_at: row.expires_at,
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }

  async createPayment(
    authorization: string | undefined,
    idempotencyHeader: string | undefined,
    body: unknown,
  ) {
    const merchant = await this.authenticate(authorization);
    const key = validateIdempotencyKey(idempotencyHeader);
    const input = validateNewPayment(body);
    const fingerprint = fingerprintPayment(input);

    // PostgreSQL's unique constraint serializes even truly concurrent requests.
    // A request with the same key and different normalized payload is rejected.
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO public.payments (
         merchant_id, merchant_order_id, amount_paisa, currency, status,
         success_url, cancel_url, idempotency_key, request_fingerprint
       ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)
       ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [merchant.id, input.merchant_order_id, input.amount_paisa, input.currency,
       input.success_url, input.cancel_url, key, fingerprint],
    );

    if (inserted.rows.length === 0) {
      const found = await pool.query<{ id: string; request_fingerprint: string }>(
        `SELECT id, request_fingerprint FROM public.payments
         WHERE merchant_id = $1::uuid AND idempotency_key = $2`,
        [merchant.id, key],
      );
      const previous = found.rows[0];
      if (!previous) throw new ConflictException('Please retry the idempotent request');
      if (previous.request_fingerprint !== fingerprint) {
        throw new ConflictException('This Idempotency-Key was already used with different payment details');
      }
      return this.present(await this.findPayment(previous.id, merchant.id), true);
    }

    return this.present(await this.findPayment(inserted.rows[0].id, merchant.id), true);
  }

  async listPayments(authorization: string | undefined) {
    const merchant = await this.authenticate(authorization);
    const result = await pool.query<PaymentRow>(
      `SELECT ${this.columns} FROM public.payments p
       WHERE p.merchant_id = $1::uuid ORDER BY p.created_at DESC, p.id DESC LIMIT 100`,
      [merchant.id],
    );
    return {
      payments: result.rows.map((row) => this.present(row)),
      merchant: { id: merchant.id, business_name: merchant.business_name },
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }

  async getPayment(authorization: string | undefined, id: string) {
    const merchant = await this.authenticate(authorization);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) {
      throw new BadRequestException('Invalid payment ID');
    }
    const payment = await this.findPayment(id, merchant.id);
    // Payment and audit events are read in a single statement/snapshot so that
    // a concurrent transition cannot produce contradictory state and history.
    return { ...this.present(payment), history: payment.history ?? [] };
  }
}

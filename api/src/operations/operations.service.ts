import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { digest } from '../merchant/merchant-utils.js';
import { validateIdempotencyKey } from '../payments/payment-utils.js';
import { signWebhook, verifyWebhook } from './signature.js';
const isId = (id: string) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
@Injectable()
export class OperationsService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly merchants: MerchantService) {}
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  onModuleInit() {
    if (process.env.PAYBD_WEBHOOK_WORKER === '1') {
      this.timer = setInterval(() => {
        void this.dispatch().catch(() =>
          console.error(
            'Demo webhook worker could not complete; pending events retained.',
          ),
        );
      }, 1000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async refunds(cookie: string, id: string) {
    const merchant = await this.merchants.identity(cookie);
    if (!isId(id)) throw new BadRequestException('Invalid payment ID');
    const p = (
      await pool.query(
        'SELECT amount_paisa::float8 amount_paisa,status FROM payments WHERE id=$1 AND merchant_id=$2',
        [id, merchant.id],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Payment not found');
    const rows = (
      await pool.query(
        `SELECT r.id,r.amount_paisa::float8 amount_paisa,r.reason,r.status,r.created_at,(SELECT jsonb_agg(jsonb_build_object('status',h.status,'changed_at',h.changed_at) ORDER BY h.id) FROM refund_status_history h WHERE h.refund_id=r.id) history FROM payment_refunds r WHERE payment_id=$1 ORDER BY created_at,id`,
        [id],
      )
    ).rows;
    const recorded = rows.reduce((s, r) => s + r.amount_paisa, 0);
    const known = !(p.status === 'PARTIALLY_REFUNDED' && rows.length === 0);
    const total = p.status === 'REFUNDED' ? p.amount_paisa : recorded;
    return {
      refunds: rows,
      totals_known: known,
      refunded_paisa: known ? total : null,
      remaining_paisa: known ? p.amount_paisa - total : null,
      payment_status: p.status,
    };
  }
  async refund(
    cookie: string,
    id: string,
    key: string,
    body: Record<string, unknown>,
  ) {
    const merchant = await this.merchants.identity(cookie);
    if (!isId(id)) throw new BadRequestException('Invalid payment ID');
    const idem = validateIdempotencyKey(key);
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => !['amount_paisa', 'reason'].includes(k)) ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 200 ||
      (body.amount_paisa !== undefined &&
        (!Number.isSafeInteger(body.amount_paisa) ||
          Number(body.amount_paisa) < 1))
    )
      throw new BadRequestException(
        'Supply a reason and optional positive integer amount_paisa; omit amount for a full remaining refund',
      );
    const fp = digest(
      JSON.stringify({
        payment_id: id,
        amount_paisa: body.amount_paisa ?? null,
        reason: body.reason.trim(),
      }),
    );
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const p = (
        await db.query(
          'SELECT id,status,amount_paisa::float8 amount_paisa FROM payments WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
          [id, merchant.id],
        )
      ).rows[0];
      if (!p) throw new NotFoundException('Payment not found');
      const prior = (
        await db.query(
          'SELECT id,request_fingerprint FROM payment_refunds WHERE merchant_id=$1 AND idempotency_key=$2',
          [merchant.id, idem],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_fingerprint !== fp)
          throw new ConflictException(
            'Refund key already used with other details',
          );
        await db.query('COMMIT');
        return { id: prior.id, status: 'SUCCEEDED', test_mode: true };
      }
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(p.status))
        throw new ConflictException(
          'Only paid or partially refunded payments may be refunded',
        );
      const total = Number(
        (
          await db.query(
            'SELECT COALESCE(sum(amount_paisa),0) total FROM payment_refunds WHERE payment_id=$1',
            [id],
          )
        ).rows[0].total,
      );
      if (p.status === 'PARTIALLY_REFUNDED' && total === 0)
        throw new ConflictException(
          'This older partial refund has no recorded amount; further refunds are unavailable until its prior amount is established',
        );
      const amount =
        body.amount_paisa === undefined
          ? p.amount_paisa - total
          : Number(body.amount_paisa);
      if (amount > p.amount_paisa - total)
        throw new ConflictException('Refund exceeds the remaining amount');
      const r = await db.query(
        `INSERT INTO payment_refunds(payment_id,merchant_id,amount_paisa,reason,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(merchant_id,idempotency_key) DO NOTHING RETURNING id`,
        [id, merchant.id, amount, body.reason.trim(), idem, fp],
      );
      if (!r.rows[0])
        throw new ConflictException(
          'Refund key already used with other details',
        );
      await db.query('COMMIT');
      return { id: r.rows[0].id, status: 'SUCCEEDED', test_mode: true };
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
  async settings(cookie: string) {
    const m = await this.merchants.identity(cookie);
    const row = (
      await pool.query(
        'SELECT enabled,receiver_mode FROM merchant_webhooks WHERE merchant_id=$1',
        [m.id],
      )
    ).rows[0];
    return {
      enabled: row?.enabled ?? false,
      receiver_mode: row?.receiver_mode ?? 'success',
      destination: 'Built-in local demo receiver',
      signing:
        'HMAC-SHA256 over timestamp.rawBody; secret retained privately in database',
      max_attempts: 5,
    };
  }
  async configure(cookie: string, body: Record<string, unknown>) {
    const m = await this.merchants.identity(cookie);
    if (
      !body ||
      typeof body.enabled !== 'boolean' ||
      !['success', 'fail_twice', 'always_fail'].includes(
        String(body.receiver_mode),
      ) ||
      Object.keys(body).some((k) => !['enabled', 'receiver_mode'].includes(k))
    )
      throw new BadRequestException('Set enabled and receiver_mode');
    await pool.query(
      `INSERT INTO merchant_webhooks(merchant_id,signing_secret,enabled,receiver_mode) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_id) DO UPDATE SET enabled=EXCLUDED.enabled,receiver_mode=EXCLUDED.receiver_mode`,
      [m.id, randomBytes(32).toString('hex'), body.enabled, body.receiver_mode],
    );
    return this.settings(cookie);
  }
  async logs(cookie: string) {
    const m = await this.merchants.identity(cookie);
    return {
      events: (
        await pool.query(
          `SELECT e.id,e.event_type,e.payload,e.status,e.attempts,e.next_attempt_at,e.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('attempt',d.attempt,'http_status',d.http_status,'result',d.result,'signature_valid',d.signature_valid,'created_at',d.created_at) ORDER BY d.attempt) FROM webhook_deliveries d WHERE d.event_id=e.id),'[]') deliveries FROM webhook_events e WHERE e.merchant_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
          [m.id],
        )
      ).rows,
    };
  }
  async retry(cookie: string, id: string) {
    const m = await this.merchants.identity(cookie);
    if (!isId(id)) throw new BadRequestException('Invalid event ID');
    const r = await pool.query(
      "UPDATE webhook_events SET status='RETRY',next_attempt_at=now() WHERE id=$1 AND merchant_id=$2 AND status IN ('FAILED','RETRY') AND (locked_until IS NULL OR locked_until<now()) RETURNING id",
      [id, m.id],
    );
    if (!r.rows[0])
      throw new ConflictException(
        'Event is unavailable, already delivered or being processed',
      );
    return { ok: true };
  }
  async receive(id: string, timestamp: string, signature: string, raw: Buffer) {
    if (!isId(id)) return { status: 401 };
    const r = (
      await pool.query(
        'SELECT e.id,e.attempts,e.status,w.signing_secret,w.receiver_mode FROM webhook_events e JOIN merchant_webhooks w ON w.merchant_id=e.merchant_id WHERE e.id=$1',
        [id],
      )
    ).rows[0];
    if (!r || !verifyWebhook(r.signing_secret, timestamp, raw, signature))
      return { status: 401 };
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return { status: 400 };
    }
    if (body.id !== id) return { status: 400 };
    if (
      (
        await pool.query('SELECT 1 FROM webhook_receipts WHERE event_id=$1', [
          id,
        ])
      ).rowCount
    )
      return { status: 200 };
    if (
      r.receiver_mode === 'always_fail' ||
      (r.receiver_mode === 'fail_twice' && r.attempts <= 2)
    )
      return { status: 503 };
    await pool.query(
      'INSERT INTO webhook_receipts(event_id) VALUES($1) ON CONFLICT DO NOTHING',
      [id],
    );
    return { status: 200 };
  }
  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 20; i++) {
        const lease = randomUUID();
        const rows = await pool.query(
          `WITH due AS (SELECT e.id FROM webhook_events e JOIN merchant_webhooks w ON w.merchant_id=e.merchant_id WHERE w.enabled AND e.status IN ('PENDING','RETRY') AND e.next_attempt_at<=now() AND (e.locked_until IS NULL OR e.locked_until<now()) ORDER BY e.created_at FOR UPDATE OF e SKIP LOCKED LIMIT 1) UPDATE webhook_events e SET locked_until=now()+interval '30 seconds',lease_id=$1,attempts=attempts+1 FROM due WHERE e.id=due.id RETURNING e.*`,
          [lease],
        );
        const e = rows.rows[0];
        if (!e) break;
        const config = (
          await pool.query(
            'SELECT signing_secret FROM merchant_webhooks WHERE merchant_id=$1',
            [e.merchant_id],
          )
        ).rows[0];
        const body = JSON.stringify({
          id: e.id,
          type: e.event_type,
          created_at: e.created_at,
          data: e.payload,
          test_mode: true,
        });
        const timestamp = Math.floor(Date.now() / 1000).toString();
        let status: number | null = null,
          valid = false;
        try {
          const response = await fetch(
            `http://127.0.0.1:${Number(process.env.PORT ?? 3000)}/v1/demo/webhook-receiver`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-PayBD-Event': e.id,
                'X-PayBD-Timestamp': timestamp,
                'X-PayBD-Signature': signWebhook(
                  config.signing_secret,
                  timestamp,
                  body,
                ),
              },
              body,
              redirect: 'error',
              signal: AbortSignal.timeout(5000),
            },
          );
          status = response.status;
          valid = response.headers.get('x-paybd-verified') === 'true';
          await response.body?.cancel();
        } catch {
          /* fixed sanitized result only */
        }
        const success = status !== null && status >= 200 && status < 300;
        const db = await pool.connect();
        try {
          await db.query('BEGIN');
          const own = await db.query(
            'SELECT id FROM webhook_events WHERE id=$1 AND lease_id=$2 FOR UPDATE',
            [e.id, lease],
          );
          if (own.rowCount) {
            await db.query(
              'INSERT INTO webhook_deliveries(event_id,attempt,http_status,result,signature_valid) VALUES($1,$2,$3,$4,$5)',
              [
                e.id,
                e.attempts,
                status,
                success
                  ? 'Delivered'
                  : status
                    ? 'Receiver rejected request'
                    : 'Connection failed or timed out',
                valid,
              ],
            );
            await db.query(
              `UPDATE webhook_events SET status=$1,next_attempt_at=now()+($2 * interval '1 second'),locked_until=NULL,lease_id=NULL,delivered_at=CASE WHEN $3 THEN now() ELSE delivered_at END WHERE id=$4`,
              [
                success
                  ? 'DELIVERED'
                  : e.attempts % 5 === 0
                    ? 'FAILED'
                    : 'RETRY',
                Math.min(60, 2 ** (e.attempts % 5)),
                success,
                e.id,
              ],
            );
          }
          await db.query('COMMIT');
        } catch (err) {
          await db.query('ROLLBACK');
          throw err;
        } finally {
          db.release();
        }
      }
    } finally {
      this.running = false;
    }
  }
}

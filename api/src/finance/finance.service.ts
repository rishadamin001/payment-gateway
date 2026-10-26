import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { digest } from '../merchant/merchant-utils.js';
import {
  validateIdempotencyKey,
  DEMO_NOTICE,
} from '../payments/payment-utils.js';
import { settlementInput, payoutInput, financialId } from './finance-utils.js';

@Injectable()
export class FinanceService {
  constructor(private readonly merchants: MerchantService) {}
  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
    readonly = false,
  ): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query(
        readonly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN',
      );
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      if ((error as { code?: string }).code === '23514')
        throw new ConflictException(
          'The simulated finance operation is not available: check balance, merchant status and reconciliation',
        );
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'This settlement, payout or idempotency key has already been used',
        );
      throw error;
    } finally {
      db.release();
    }
  }
  private async active(cookie: string) {
    const m = await this.merchants.identity(cookie);
    if (m.status !== 'ACTIVE')
      throw new ForbiddenException(
        'Merchant must be active for simulated settlements and payouts',
      );
    return m;
  }
  private readonly settlementsSql = `SELECT s.id,s.amount_paisa::float8 AS amount_paisa,s.created_at,p.id AS payout_id,
    CASE WHEN p.id IS NULL THEN 'READY' ELSE 'PAID_OUT' END AS status
    FROM simulated_settlements s LEFT JOIN simulated_payouts p ON p.settlement_id=s.id`;
  private readonly payoutsSql =
    'SELECT id,settlement_id,amount_paisa::float8 AS amount_paisa,status,created_at FROM simulated_payouts';
  async overview(cookie: string) {
    const m = await this.merchants.identity(cookie);
    return this.transaction(async (db) => {
      const b = (
        await db.query(
          `SELECT paybd_finance_balance($1,'MERCHANT_PAYABLE')::float8 AS available_paisa,
        paybd_finance_balance($1,'SETTLEMENT_PAYABLE')::float8 AS reserved_paisa,
        -paybd_finance_balance($1,'CLEARING')::float8 AS clearing_paisa`,
          [m.id],
        )
      ).rows[0];
      const settlements = (
        await db.query(
          this.settlementsSql +
            ' WHERE s.merchant_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 100',
          [m.id],
        )
      ).rows;
      const payouts = (
        await db.query(
          this.payoutsSql +
            ' WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
          [m.id],
        )
      ).rows;
      const journals = (
        await db.query(
          `SELECT j.id,j.source_type,j.source_id,j.amount_paisa::float8 AS amount_paisa,j.created_at,
        (SELECT jsonb_agg(jsonb_build_object('account',e.account,'side',e.side,'amount_paisa',e.amount_paisa) ORDER BY e.side DESC) FROM ledger_entries e WHERE e.journal_id=j.id) AS entries
        FROM ledger_journals j WHERE j.merchant_id=$1 ORDER BY j.created_at DESC,j.id DESC LIMIT 100`,
          [m.id],
        )
      ).rows;
      return {
        balances: b,
        settlements,
        payouts,
        journals,
        test_mode: true,
        notice: DEMO_NOTICE,
      };
    }, true);
  }
  async reconciliation(cookie: string) {
    const m = await this.merchants.identity(cookie);
    const r = (
      await pool.query(
        `WITH source AS (
      SELECT COALESCE(sum(p.amount_paisa),0)::float8 AS payment_total_paisa,
      COALESCE(sum(CASE WHEN p.status='REFUNDED' THEN p.amount_paisa ELSE COALESCE((SELECT sum(r.amount_paisa) FROM payment_refunds r WHERE r.payment_id=p.id),0) END),0)::float8 AS refund_total_paisa
      FROM payments p WHERE p.merchant_id=$1 AND p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
    ), posted AS (
      SELECT COALESCE(sum(amount_paisa) FILTER(WHERE source_type='PAYMENT'),0)::float8 AS ledger_payment_paisa,
      COALESCE(sum(amount_paisa) FILTER(WHERE source_type IN ('REFUND','LEGACY_REFUND')),0)::float8 AS ledger_refund_paisa,
      COALESCE(sum(amount_paisa) FILTER(WHERE source_type='PAYOUT'),0)::float8 AS ledger_payout_paisa
      FROM ledger_journals WHERE merchant_id=$1
    ), books AS (
      SELECT COALESCE(sum(CASE WHEN e.side='DEBIT' THEN e.amount_paisa ELSE -e.amount_paisa END),0)::float8 AS imbalance_paisa,
      COALESCE(sum(CASE WHEN e.side='DEBIT' THEN e.amount_paisa ELSE -e.amount_paisa END) FILTER(WHERE e.account='CLEARING'),0)::float8 AS clearing_paisa
      FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE j.merchant_id=$1
    ) SELECT source.*,posted.*,books.*,paybd_unknown_refunds($1)::int AS unknown_legacy_refunds,
      (SELECT COALESCE(sum(amount_paisa),0)::float8 FROM simulated_payouts WHERE merchant_id=$1) AS payout_total_paisa FROM source,posted,books`,
        [m.id],
      )
    ).rows[0];
    const expected =
      r.payment_total_paisa - r.refund_total_paisa - r.payout_total_paisa;
    const discrepancies: string[] = [];
    if (r.unknown_legacy_refunds)
      discrepancies.push(
        'Older partially refunded payments have unknown refund amounts; settlements and payouts are blocked for review.',
      );
    if (r.payment_total_paisa !== r.ledger_payment_paisa)
      discrepancies.push('Payment and ledger capture totals differ.');
    if (r.refund_total_paisa !== r.ledger_refund_paisa)
      discrepancies.push('Refund and ledger refund totals differ.');
    if (r.payout_total_paisa !== r.ledger_payout_paisa)
      discrepancies.push('Payout records and ledger payouts differ.');
    if (r.imbalance_paisa !== 0)
      discrepancies.push('Ledger debits and credits do not balance.');
    if (expected !== r.clearing_paisa)
      discrepancies.push(
        'Expected clearing and ledger clearing balances differ.',
      );
    return {
      ...r,
      expected_clearing_paisa: expected,
      discrepancies,
      status: discrepancies.length ? 'REVIEW_REQUIRED' : 'MATCHED',
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }
  async settle(cookie: string, keyHeader: string, body: unknown) {
    const m = await this.active(cookie),
      key = validateIdempotencyKey(keyHeader),
      requested = settlementInput(body);
    const fingerprint = digest(JSON.stringify({ amount_paisa: requested }));
    return this.transaction(async (db) => {
      await db.query('SELECT paybd_lock_finance($1)', [m.id]);
      const prior = (
        await db.query(
          'SELECT id,request_fingerprint FROM simulated_settlements WHERE merchant_id=$1 AND idempotency_key=$2',
          [m.id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_fingerprint !== fingerprint)
          throw new ConflictException(
            'Settlement key already used with different details',
          );
        return {
          ...(
            await db.query(this.settlementsSql + ' WHERE s.id=$1', [prior.id])
          ).rows[0],
          test_mode: true,
        };
      }
      const state = (
        await db.query(
          "SELECT paybd_finance_balance($1,'MERCHANT_PAYABLE')::float8 AS available,paybd_unknown_refunds($1)::int AS unknown",
          [m.id],
        )
      ).rows[0];
      if (state.unknown)
        throw new ConflictException(
          'Unknown earlier refund amounts require reconciliation review before settlement',
        );
      const paisa = requested ?? state.available;
      if (paisa <= 0 || paisa > state.available)
        throw new ConflictException(
          'Settlement must fit the available positive balance',
        );
      if (paisa > 100000000000)
        throw new ConflictException(
          'Split this balance into settlements of at most 100000000000 paisa',
        );
      const s = (
        await db.query(
          'INSERT INTO simulated_settlements(merchant_id,amount_paisa,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4) RETURNING id',
          [m.id, paisa, key, fingerprint],
        )
      ).rows[0];
      return {
        ...(await db.query(this.settlementsSql + ' WHERE s.id=$1', [s.id]))
          .rows[0],
        test_mode: true,
      };
    });
  }
  async payout(cookie: string, id: string, keyHeader: string, body: unknown) {
    const m = await this.active(cookie);
    financialId(id);
    payoutInput(body);
    const key = validateIdempotencyKey(keyHeader),
      fingerprint = digest(JSON.stringify({ settlement_id: id }));
    return this.transaction(async (db) => {
      await db.query('SELECT paybd_lock_finance($1)', [m.id]);
      const s = (
        await db.query(
          'SELECT id,amount_paisa FROM simulated_settlements WHERE id=$1 AND merchant_id=$2',
          [id, m.id],
        )
      ).rows[0];
      if (!s) throw new NotFoundException('Settlement not found');
      const prior = (
        await db.query(
          'SELECT id,request_fingerprint FROM simulated_payouts WHERE merchant_id=$1 AND idempotency_key=$2',
          [m.id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_fingerprint !== fingerprint)
          throw new ConflictException(
            'Payout key already used with different details',
          );
        return {
          ...(await db.query(this.payoutsSql + ' WHERE id=$1', [prior.id]))
            .rows[0],
          test_mode: true,
        };
      }
      if (
        (
          await db.query(
            'SELECT id FROM simulated_payouts WHERE settlement_id=$1',
            [id],
          )
        ).rowCount
      )
        throw new ConflictException(
          'This settlement has already been paid out',
        );
      const state = (
        await db.query(
          "SELECT -paybd_finance_balance($1,'CLEARING')::float8 AS clearing,paybd_unknown_refunds($1)::int AS unknown",
          [m.id],
        )
      ).rows[0];
      if (state.unknown || Number(s.amount_paisa) > state.clearing)
        throw new ConflictException(
          'Reconciliation or the clearing balance prevents this payout after refunds',
        );
      const p = (
        await db.query(
          'INSERT INTO simulated_payouts(settlement_id,merchant_id,amount_paisa,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5) RETURNING id',
          [id, m.id, s.amount_paisa, key, fingerprint],
        )
      ).rows[0];
      return {
        ...(await db.query(this.payoutsSql + ' WHERE id=$1', [p.id])).rows[0],
        test_mode: true,
      };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  checkPassword,
  credentials,
  digest,
  hashPassword,
} from '../merchant/merchant-utils.js';
import {
  adminToken,
  FAILURE_THRESHOLD,
  HIGH_AMOUNT_PAISA,
  pageNumber,
  riskFlags,
  validId,
} from './admin-utils.js';

type Admin = { id: string; email: string };
const paymentStatuses = [
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];
@Injectable()
export class AdminService {
  async identity(cookie?: string): Promise<Admin> {
    const token = adminToken(cookie);
    if (!token)
      throw new UnauthorizedException('Sign in to the administrator account');
    const r = await pool.query<Admin>(
      `SELECT a.id,a.email FROM admin_sessions s JOIN admin_accounts a ON a.id=s.admin_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [digest(token)],
    );
    if (!r.rows[0])
      throw new UnauthorizedException(
        'Administrator session expired; sign in again',
      );
    return r.rows[0];
  }
  async setupStatus() {
    return {
      setup_required: !(
        await pool.query('SELECT 1 FROM admin_accounts LIMIT 1')
      ).rowCount,
    };
  }
  private loginInput(body: Record<string, unknown>) {
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['email', 'password'].includes(key))
    )
      throw new BadRequestException(
        'Supply an administrator email and password',
      );
    return credentials(body);
  }
  private async session(db: PoolClient, id: string, action: string) {
    const token = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '8 hours')",
      [digest(token), id],
    );
    await db.query(
      "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id) VALUES('ADMIN',$1::uuid,$2,'admin_accounts',$1::text)",
      [id, action],
    );
    return token;
  }
  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const value = await work(db);
      await db.query('COMMIT');
      return value;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async setup(body: Record<string, unknown>) {
    const input = this.loginInput(body),
      passwordHash = await hashPassword(input.password);
    return this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(465000009)');
      if ((await db.query('SELECT 1 FROM admin_accounts LIMIT 1')).rowCount)
        throw new ConflictException(
          'An administrator already exists; use sign in',
        );
      const r = await db.query<{ id: string }>(
        'INSERT INTO admin_accounts(email,password_hash) VALUES($1,$2) RETURNING id',
        [input.email, passwordHash],
      );
      return this.session(db, r.rows[0].id, 'admin.setup');
    });
  }
  async login(body: Record<string, unknown>) {
    const input = this.loginInput(body),
      identityHash = digest(input.email);
    // Record attempts atomically, so concurrent requests cannot bypass the limit.
    await this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,465))', [
        identityHash,
      ]);
      const count = await db.query(
        "SELECT count(*)::int n FROM admin_login_attempts WHERE identity_hash=$1 AND created_at>clock_timestamp()-interval '15 minutes'",
        [identityHash],
      );
      if (count.rows[0].n >= 10)
        throw new HttpException(
          'Too many administrator sign-in attempts; try in 15 minutes',
          429,
        );
      await db.query(
        'INSERT INTO admin_login_attempts(identity_hash) VALUES($1)',
        [identityHash],
      );
    });
    const account = (
      await pool.query<{ id: string; password_hash: string }>(
        'SELECT id,password_hash FROM admin_accounts WHERE email=$1',
        [input.email],
      )
    ).rows[0];
    const matches = await checkPassword(
      input.password,
      account?.password_hash ??
        '00000000000000000000000000000000:' + '00'.repeat(64),
    );
    if (!account || !matches)
      throw new UnauthorizedException(
        'Administrator email or password is incorrect',
      );
    return this.transaction((db) =>
      this.session(db, account.id, 'admin.login'),
    );
  }
  async logout(cookie?: string) {
    const token = adminToken(cookie);
    if (token)
      await this.transaction(async (db) => {
        const r = await db.query<{ admin_id: string }>(
          'UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING admin_id',
          [digest(token)],
        );
        if (r.rows[0])
          await db.query(
            "INSERT INTO audit_log(actor_type,actor_id,action,entity_type,entity_id) VALUES('ADMIN',$1::uuid,'admin.logout','admin_accounts',$1::text)",
            [r.rows[0].admin_id],
          );
      });
    return { ok: true };
  }
  private search(
    q: Record<string, string>,
    columns: string[],
    values: unknown[],
    clauses: string[],
  ) {
    if (!q.search) return;
    if (q.search.length > 100)
      throw new BadRequestException('Search is limited to 100 characters');
    values.push(`%${q.search}%`);
    clauses.push(
      `(${columns.map((column) => `${column} ILIKE $${values.length}`).join(' OR ')})`,
    );
  }
  private merchantColumns =
    "id,business_name,email,status,approved_at,created_at,CASE WHEN approved_at IS NULL THEN 'PENDING_REVIEW' ELSE 'APPROVED' END AS approval_status";
  async merchants(cookie: string, q: Record<string, string>) {
    await this.identity(cookie);
    const page = pageNumber(q.page),
      values: unknown[] = [],
      clauses = ['true'];
    this.search(q, ['business_name', 'email', 'id::text'], values, clauses);
    if (q.status) {
      if (!['ACTIVE', 'SUSPENDED', 'PENDING'].includes(q.status))
        throw new BadRequestException('Invalid merchant status');
      values.push(q.status);
      clauses.push(`status=$${values.length}`);
    }
    const where = clauses.join(' AND ');
    const count = await pool.query(
      `SELECT count(*)::int n FROM merchants WHERE ${where}`,
      values,
    );
    const r = await pool.query(
      `SELECT ${this.merchantColumns} FROM merchants WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      values,
    );
    return { merchants: r.rows, total: count.rows[0].n, page, test_mode: true };
  }
  async merchantStatus(
    cookie: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    const admin = await this.identity(cookie);
    validId(id);
    if (
      !body ||
      Object.keys(body).some((key) => !['status', 'reason'].includes(key)) ||
      !['ACTIVE', 'SUSPENDED'].includes(String(body.status)) ||
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 200 ||
      /[\x00-\x1f\x7f]/.test(body.reason)
    )
      throw new BadRequestException(
        'Choose ACTIVE or SUSPENDED and provide a reason of at most 200 characters',
      );
    const reason = body.reason.trim();
    return this.transaction(async (db) => {
      await db.query(
        "SELECT set_config('paybd.admin_actor',$1,true),set_config('paybd.admin_reason',$2,true)",
        [admin.id, reason],
      );
      const r = await db.query(
        `UPDATE merchants SET status=$1,approved_at=CASE WHEN $1='ACTIVE' THEN COALESCE(approved_at,clock_timestamp()) ELSE approved_at END WHERE id=$2 RETURNING ${this.merchantColumns}`,
        [body.status, id],
      );
      if (!r.rows[0]) throw new NotFoundException('Merchant not found');
      return r.rows[0];
    });
  }
  async transactions(cookie: string, q: Record<string, string>) {
    await this.identity(cookie);
    const page = pageNumber(q.page),
      values: unknown[] = [],
      clauses = ['true'];
    this.search(
      q,
      ['p.id::text', 'p.merchant_order_id', 'm.business_name'],
      values,
      clauses,
    );
    if (q.status) {
      if (!paymentStatuses.includes(q.status))
        throw new BadRequestException('Invalid payment status');
      values.push(q.status);
      clauses.push(`p.status=$${values.length}`);
    }
    if (q.merchant_id) {
      validId(q.merchant_id);
      values.push(q.merchant_id);
      clauses.push(`p.merchant_id=$${values.length}`);
    }
    const where = clauses.join(' AND ');
    const count = await pool.query(
      `SELECT count(*)::int n FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE ${where}`,
      values,
    );
    const r = await pool.query(
      `SELECT p.id,p.merchant_id,m.business_name,p.merchant_order_id,p.amount_paisa::float8 amount_paisa,p.status,p.created_at,
      (SELECT count(*)::int FROM payments f WHERE f.merchant_id=p.merchant_id AND f.status='FAILED' AND f.created_at>clock_timestamp()-interval '24 hours') failure_count
      FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      values,
    );
    return {
      payments: r.rows.map(({ failure_count, ...payment }) => ({
        ...payment,
        risk_flags: riskFlags(payment.amount_paisa, failure_count),
      })),
      total: count.rows[0].n,
      page,
      test_mode: true,
    };
  }
  async risk(cookie: string) {
    await this.identity(cookie);
    const high = await pool.query(
      `SELECT p.merchant_id,m.business_name,p.id payment_id,p.amount_paisa::float8 amount_paisa FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.amount_paisa >= $1 ORDER BY p.created_at DESC,p.id DESC LIMIT 100`,
      [HIGH_AMOUNT_PAISA],
    );
    const failures = await pool.query(
      `SELECT p.merchant_id,m.business_name,count(*)::int failure_count FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE p.status='FAILED' AND p.created_at>clock_timestamp()-interval '24 hours' GROUP BY p.merchant_id,m.business_name HAVING count(*) >= $1 ORDER BY count(*) DESC,p.merchant_id LIMIT 100`,
      [FAILURE_THRESHOLD],
    );
    return {
      flags: [
        ...high.rows.map((row) => ({
          ...row,
          code: 'UNUSUAL_AMOUNT',
          description:
            'Demo amount is at least BDT 100,000; review this fictional transaction.',
        })),
        ...failures.rows.map((row) => ({
          ...row,
          code: 'REPEATED_FAILURES',
          description:
            'At least three failed attempts in 24 hours; review the simulation.',
        })),
      ],
      threshold_paisa: HIGH_AMOUNT_PAISA,
      failure_threshold: FAILURE_THRESHOLD,
      window_hours: 24,
      test_mode: true,
    };
  }
  async audit(cookie: string, q: Record<string, string>) {
    await this.identity(cookie);
    const page = pageNumber(q.page),
      values: unknown[] = [],
      clauses = ['true'];
    if (q.merchant_id) {
      validId(q.merchant_id);
      values.push(q.merchant_id);
      clauses.push(`merchant_id=$${values.length}`);
    }
    if (q.action) {
      if (!/^[a-z_.]{1,80}$/.test(q.action))
        throw new BadRequestException('Invalid audit action');
      values.push(q.action);
      clauses.push(`action=$${values.length}`);
    }
    const where = clauses.join(' AND ');
    const count = await pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE ${where}`,
      values,
    );
    const events = await pool.query(
      `SELECT id::text,actor_type,actor_id,merchant_id,action,entity_type,entity_id,metadata,created_at FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
      values,
    );
    return {
      events: events.rows,
      total: count.rows[0].n,
      page,
      test_mode: true,
    };
  }
}

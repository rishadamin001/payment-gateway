import { describe, it, expect, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { bootstrapHostedAdmin } from './hosted-bootstrap.js';
import { checkPassword } from '../merchant/merchant-utils.js';
const email = 'hosted-admin@example.test';
const password = randomBytes(24).toString('hex');
function database(existing: { email: string }[]) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (sql.startsWith('SELECT email')) return { rows: existing, rowCount: existing.length };
    return { rows: [{ id: randomUUID() }], rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  return { pool: { connect: async () => client } as unknown as Pool, client };
}
describe('hosted administrator bootstrap', () => {
  it('hashes the initial password and audits creation within a locked transaction', async () => {
    const { pool, client } = database([]);
    await bootstrapHostedAdmin(pool, { PAYBD_ADMIN_EMAIL: email, PAYBD_ADMIN_PASSWORD: password });
    const insert = client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO admin_accounts'))!;
    expect(insert[1]?.[1]).not.toBe(password);
    expect(await checkPassword(password, String(insert[1]?.[1]))).toBe(true);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('admin.hosted_setup'))).toBe(true);
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('never changes an existing password and rejects taking over a different administrator', async () => {
    const same = database([{ email }]);
    await bootstrapHostedAdmin(same.pool, { PAYBD_ADMIN_EMAIL: email, PAYBD_ADMIN_PASSWORD: password });
    expect(same.client.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
    const other = database([{ email: 'another@example.test' }]);
    await expect(bootstrapHostedAdmin(other.pool, { PAYBD_ADMIN_EMAIL: email, PAYBD_ADMIN_PASSWORD: password })).rejects.toThrow();
    expect(other.client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(other.client.release).toHaveBeenCalledOnce();
  });
});

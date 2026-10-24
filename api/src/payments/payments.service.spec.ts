import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
import { PaymentsService } from './payments.service.js';

const testAuthorization = `Bearer paybd_test_${randomBytes(32).toString('base64url')}`;

async function statusOf(operation: Promise<unknown>) {
  try {
    await operation;
    return 200;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
}

describe('Merchant test-key authentication', () => {
  const service = new PaymentsService();

  beforeEach(() => database.query.mockReset());

  it('rejects missing, malformed and live keys before any database access', async () => {
    for (const authorization of [undefined, '', 'Basic invalid', 'Bearer paybd_live_invalid']) {
      expect(await statusOf(service.listPayments(authorization))).toBe(401);
    }
    expect(database.query).not.toHaveBeenCalled();
  });

  it('rejects keys without an active matching registration', async () => {
    database.query.mockResolvedValue({ rows: [] });
    expect(await statusOf(service.listPayments(testAuthorization))).toBe(401);
  });

  it('rejects an unapproved merchant even with a registered key', async () => {
    database.query.mockResolvedValue({ rows: [{ id: 'merchant', status: 'PENDING' }] });
    expect(await statusOf(service.listPayments(testAuthorization))).toBe(403);
  });

  it('authenticates before exposing payment validation or lookup results', async () => {
    expect(await statusOf(service.getPayment(undefined, 'invalid-id'))).toBe(401);
    expect(await statusOf(service.createPayment(undefined, undefined, null))).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });
});

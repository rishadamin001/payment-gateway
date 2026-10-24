import { describe, expect, it } from 'vitest';
import {
  canTransition, checkoutBaseUrl, fingerprintPayment, formatBDT,
  validateIdempotencyKey, validateNewPayment,
  PAYMENT_STATUSES,
} from './payment-utils.js';

const valid = {
  amount_paisa: 150000,
  currency: 'BDT',
  merchant_order_id: 'ORDER-1001',
  success_url: 'http://localhost:3001/demo/success',
  cancel_url: 'http://localhost:3001/demo/cancel',
};

describe('M1 simulated BDT payments', () => {
  it('validates checkout configuration without leaking invalid credentials', () => {
    expect(checkoutBaseUrl(undefined)).toBe('http://localhost:3001');
    expect(checkoutBaseUrl('https://paybd.example.test/path')).toBe('https://paybd.example.test');
    for (const value of ['ftp://example.test', 'not-a-url', 'https://user:password@example.test']) {
      expect(() => checkoutBaseUrl(value)).toThrow('PAYBD_CHECKOUT_BASE_URL must be an HTTP(S) origin without credentials');
    }
  });
  it('accepts a 150000-paisa test payment', () => {
    expect(validateNewPayment(valid).amount_paisa).toBe(150000);
  });
  it('rejects non-integer, negative, zero and excessive amounts', () => {
    for (const amount of [0, -1, 1.5, 100000000001, '150000']) {
      expect(() => validateNewPayment({ ...valid, amount_paisa: amount })).toThrow();
    }
  });
  it('rejects non-BDT', () => {
    expect(() => validateNewPayment({ ...valid, currency: 'USD' })).toThrow();
  });
  it('rejects unknown fields so card data cannot be accepted accidentally', () => {
    expect(() => validateNewPayment({ ...valid, card: 'not accepted' })).toThrow();
  });
  it('rejects missing, malformed and control-character-bearing payloads', () => {
    for (const input of [null, [], 'payment', {}, { ...valid, merchant_order_id: ' ' },
      { ...valid, merchant_order_id: 'ORDER\u0000' }, { ...valid, merchant_order_id: 'a'.repeat(101) }]) {
      expect(() => validateNewPayment(input)).toThrow();
    }
  });
  it('rejects unsafe callback protocols and credential-bearing URLs', () => {
    for (const url of ['javascript:alert(1)', 'file:///tmp/x', 'http://user:password@example.test/']) {
      expect(() => validateNewPayment({ ...valid, success_url: url })).toThrow();
    }
  });
  it('validates idempotency keys', () => {
    expect(validateIdempotencyKey('order-1001-attempt-1')).toBe('order-1001-attempt-1');
    for (const key of [undefined, '', 'short', 'spaces are bad']) {
      expect(() => validateIdempotencyKey(key)).toThrow();
    }
  });
  it('uses stable request fingerprints, sensitive to changed payloads', () => {
    const original = validateNewPayment(valid);
    expect(fingerprintPayment(original)).toBe(fingerprintPayment(original));
    expect(fingerprintPayment(original)).not.toBe(
      fingerprintPayment(validateNewPayment({ ...valid, amount_paisa: 250000 })),
    );
    expect(fingerprintPayment(original)).toBe(fingerprintPayment(validateNewPayment({
      cancel_url: valid.cancel_url, success_url: valid.success_url,
      merchant_order_id: ' ORDER-1001 ', currency: valid.currency, amount_paisa: valid.amount_paisa,
    })));
  });
  it('displays amounts with a taka symbol', () => {
    expect(formatBDT(150000)).toBe('৳1,500.00');
    expect(formatBDT(1)).toBe('৳0.01');
    expect(formatBDT(100000000000)).toBe('৳1,000,000,000.00');
  });
});

describe('M1 state transitions from docs/payment-workflow.md', () => {
  it('matches all 49 pairs, with exactly seven legal transitions', () => {
    const allowed = new Set([
      'PENDING:PAID', 'PENDING:FAILED', 'PENDING:CANCELLED', 'PENDING:EXPIRED',
      'PAID:REFUNDED', 'PAID:PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED:REFUNDED',
    ]);
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.has(`${from}:${to}`));
      }
    }
  });
  it('permits pending outcomes', () => {
    for (const next of ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(canTransition('PENDING', next)).toBe(true);
    }
  });
  it('permits refunds after successful payment', () => {
    expect(canTransition('PAID', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(canTransition('PAID', 'REFUNDED')).toBe(true);
    expect(canTransition('PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
  });
  it('blocks backwards and final-state transitions', () => {
    for (const from of ['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'] as const) {
      expect(canTransition(from, 'PAID')).toBe(false);
    }
    expect(canTransition('PAID', 'PENDING')).toBe(false);
    expect(canTransition('PARTIALLY_REFUNDED', 'PAID')).toBe(false);
  });
});

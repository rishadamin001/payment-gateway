import { describe, expect, it } from 'vitest';
import { adminToken, pageNumber, riskFlags } from './admin-utils.js';

describe('admin boundaries', () => {
  it('flags unusual amounts and repeated failures at the documented thresholds', () => {
    expect(riskFlags(9999999, 2)).toEqual([]);
    expect(riskFlags(10000000, 2)).toEqual(['UNUSUAL_AMOUNT']);
    expect(riskFlags(100, 3)).toEqual(['REPEATED_FAILURES']);
    expect(riskFlags(10000001, 4)).toEqual([
      'UNUSUAL_AMOUNT',
      'REPEATED_FAILURES',
    ]);
  });
  it('accepts only bounded whole-number pages', () => {
    expect(pageNumber()).toBe(1);
    expect(pageNumber('2')).toBe(2);
    for (const value of ['0', '-1', '1.5', 'NaN', '100001'])
      expect(() => pageNumber(value)).toThrow();
  });
  it('keeps administrator and merchant session cookies separate', () => {
    const token = 'a'.repeat(64);
    expect(adminToken(`paybd_session=${token}`)).toBeNull();
    expect(
      adminToken(`paybd_session=other; paybd_admin_session=${token}`),
    ).toBe(token);
    expect(adminToken('paybd_admin_session=invalid')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { amount, date, invoiceItems } from './billing-utils.js';
describe('billing validation', () => {
  it('calculates line totals in integer paisa', () =>
    expect(
      invoiceItems([
        {
          description: 'Fictional notebook',
          quantity: 3,
          unit_amount_paisa: 12550,
        },
      ]).total,
    ).toBe(37650));
  it('rejects fractions, negative amounts and unsafe totals', () => {
    for (const n of [0, -1, 1.1, Number.MAX_SAFE_INTEGER])
      expect(() => amount(n)).toThrow();
    expect(() =>
      invoiceItems([
        {
          description: 'Large',
          quantity: 10000,
          unit_amount_paisa: 100000000000,
        },
      ]),
    ).toThrow();
  });
  it('rejects empty items and fractional quantities', () => {
    expect(() => invoiceItems([])).toThrow();
    expect(() =>
      invoiceItems([
        { description: 'Book', quantity: 1.5, unit_amount_paisa: 100 },
      ]),
    ).toThrow();
  });
  it('requires a valid ISO due date', () => {
    expect(date('2026-11-01T00:00:00Z', 'Due date').getUTCFullYear()).toBe(
      2026,
    );
    expect(() => date('not a date', 'Due date')).toThrow();
  });
});

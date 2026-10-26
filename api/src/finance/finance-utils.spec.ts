import { describe, it, expect } from 'vitest';
import { settlementInput, payoutInput } from './finance-utils.js';
describe('simulated finance inputs', () => {
  it('distinguishes full available balance from an explicit paisa amount', () => {
    expect(settlementInput({})).toBeNull();
    expect(settlementInput({ amount_paisa: 12550 })).toBe(12550);
  });
  it('rejects zero, fractional, oversized and unexpected settlement details', () => {
    for (const amount of [0, -1, 1.5, 100000000001, NaN, '100'])
      expect(() => settlementInput({ amount_paisa: amount })).toThrow();
    expect(() =>
      settlementInput({ bank_account: 'no real accounts' }),
    ).toThrow();
  });
  it('never accepts bank or provider data in payout requests', () => {
    expect(() => payoutInput({})).not.toThrow();
    expect(() => payoutInput({ account: 'demo' })).toThrow();
  });
});

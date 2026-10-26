import { BadRequestException } from '@nestjs/common';
export function settlementInput(body: unknown): number | null {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => k !== 'amount_paisa')
  ) {
    throw new BadRequestException('Supply only optional integer amount_paisa');
  }
  const value = (body as { amount_paisa?: unknown }).amount_paisa;
  if (value === undefined) return null;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 100000000000
  )
    throw new BadRequestException(
      'Settlement amount must be positive integer paisa, at most 100000000000',
    );
  return Number(value);
}
export function payoutInput(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length
  )
    throw new BadRequestException('Payout accepts an empty JSON object');
}
export function financialId(value: string) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw new BadRequestException('Invalid settlement ID');
}

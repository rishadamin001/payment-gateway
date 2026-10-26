import { BadRequestException } from '@nestjs/common';

export const HIGH_AMOUNT_PAISA = 10000000;
export const FAILURE_THRESHOLD = 3;
export function riskFlags(amount: number, failures: number): string[] {
  return [
    ...(amount >= HIGH_AMOUNT_PAISA ? ['UNUSUAL_AMOUNT'] : []),
    ...(failures >= FAILURE_THRESHOLD ? ['REPEATED_FAILURES'] : []),
  ];
}
export function pageNumber(value?: string): number {
  const page = Number(value ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new BadRequestException('Page must be an integer from 1 to 100000');
  return page;
}
export function validId(value: string): void {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw new BadRequestException('Invalid ID');
}
export function adminToken(cookie?: string): string | null {
  const token = cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('paybd_admin_session='))
    ?.slice('paybd_admin_session='.length);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

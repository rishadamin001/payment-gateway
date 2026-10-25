import { BadRequestException } from '@nestjs/common';

export const MAX_PAISA = 100000000000;
export type InvoiceItem = {
  description: string;
  quantity: number;
  unit_amount_paisa: number;
};
export function fields(
  body: unknown,
  allowed: string[],
): Record<string, unknown> {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  ) {
    throw new BadRequestException(
      'Only the documented demo fields are accepted',
    );
  }
  return body as Record<string, unknown>;
}
export function text(value: unknown, name: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new BadRequestException(
      `${name} is required and must be at most ${max} characters`,
    );
  }
  return value.trim();
}
export function amount(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_PAISA
  ) {
    throw new BadRequestException(
      'Amount must be positive integer paisa, at most 100000000000',
    );
  }
  return Number(value);
}
export function date(value: unknown, name: string): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new BadRequestException(`${name} must be an ISO date and time`);
  }
  return new Date(value);
}
export function invoiceItems(value: unknown): {
  items: InvoiceItem[];
  total: number;
} {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30)
    throw new BadRequestException('Add 1 to 30 invoice line items');
  let total = 0;
  const items = value.map((raw) => {
    const item = fields(raw, ['description', 'quantity', 'unit_amount_paisa']);
    if (
      !Number.isSafeInteger(item.quantity) ||
      Number(item.quantity) < 1 ||
      Number(item.quantity) > 10000
    ) {
      throw new BadRequestException(
        'Item quantity must be an integer from 1 to 10000',
      );
    }
    const normalized = {
      description: text(item.description, 'Item description', 200),
      quantity: Number(item.quantity),
      unit_amount_paisa: amount(item.unit_amount_paisa),
    };
    total += normalized.quantity * normalized.unit_amount_paisa;
    if (!Number.isSafeInteger(total) || total > MAX_PAISA)
      throw new BadRequestException('Invoice total is too large');
    return normalized;
  });
  return { items, total };
}
export function uuid(value: string): void {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
    throw new BadRequestException('Invalid ID');
}

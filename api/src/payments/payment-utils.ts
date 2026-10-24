import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const DEMO_NOTICE = 'DEMO MODE: no real money';

export function checkoutBaseUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? 'http://localhost:3001');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error('PAYBD_CHECKOUT_BASE_URL must be an HTTP(S) origin without credentials');
  }
}

export const PAYMENT_STATUSES = [
  'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED',
  'REFUNDED', 'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type NewPayment = {
  amount_paisa: number;
  currency: 'BDT';
  merchant_order_id: string;
  success_url: string;
  cancel_url: string;
};

const allowedTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return allowedTransitions[from].includes(to);
}

function asRedirectUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new BadRequestException(`${name} must be a valid HTTP(S) URL`);
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('Invalid URL');
    }
    return url.toString();
  } catch {
    throw new BadRequestException(`${name} must be a valid HTTP(S) URL`);
  }
}

export function validateNewPayment(body: unknown): NewPayment {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Payment must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const fields = ['amount_paisa', 'currency', 'merchant_order_id', 'success_url', 'cancel_url'];
  if (Object.keys(input).some((field) => !fields.includes(field))) {
    throw new BadRequestException('Only amount_paisa, currency, merchant_order_id, success_url and cancel_url are accepted');
  }
  if (typeof input.amount_paisa !== 'number' ||
      !Number.isSafeInteger(input.amount_paisa) ||
      input.amount_paisa < 1 || input.amount_paisa > 100_000_000_000) {
    throw new BadRequestException('amount_paisa must be a positive integer (max 100000000000)');
  }
  if (input.currency !== 'BDT') {
    throw new BadRequestException('Only BDT is supported in demo mode');
  }
  if (typeof input.merchant_order_id !== 'string' ||
      input.merchant_order_id.trim().length < 1 ||
      input.merchant_order_id.length > 100 || /[\u0000-\u001f\u007f]/.test(input.merchant_order_id)) {
    throw new BadRequestException('merchant_order_id must contain 1–100 characters');
  }
  return {
    amount_paisa: input.amount_paisa,
    currency: 'BDT',
    merchant_order_id: input.merchant_order_id.trim(),
    success_url: asRedirectUrl(input.success_url, 'success_url'),
    cancel_url: asRedirectUrl(input.cancel_url, 'cancel_url'),
  };
}

export function validateIdempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new BadRequestException('Idempotency-Key must contain 8–128 letters, numbers, . _ : or -');
  }
  return value;
}

export function fingerprintPayment(payment: NewPayment): string {
  return createHash('sha256').update(JSON.stringify(payment)).digest('hex');
}

// Intl formatting is presentation-only; the database and API only use integer paisa.
export function formatBDT(paisa: number): string {
  return '৳' + new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paisa / 100);
}

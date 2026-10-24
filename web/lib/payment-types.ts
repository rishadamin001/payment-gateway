export const paymentStates = [
  'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED',
] as const;
export type PaymentStatus = (typeof paymentStates)[number];
export type Payment = {
  id: string;
  merchant_id: string;
  merchant_order_id: string;
  amount_paisa: number;
  amount_display: string;
  currency: 'BDT';
  status: PaymentStatus;
  checkout_url: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  test_mode: true;
  notice: string;
  history?: { id: string; from_status: PaymentStatus | null; to_status: PaymentStatus; reason: string; changed_at: string }[];
};
export type PaymentList = { payments: Payment[]; merchant: { id: string; business_name: string }; notice: string; test_mode: true };
export const stateLabels: Record<PaymentStatus, string> = {
  PENDING: 'Pending', PAID: 'Paid', FAILED: 'Failed', CANCELLED: 'Cancelled',
  EXPIRED: 'Expired', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded',
};
export function formatTaka(paisa: number): string {
  return '৳' + new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paisa / 100);
}
export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(value));
}
export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }).format(new Date(value));
}

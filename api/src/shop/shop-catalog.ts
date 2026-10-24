import { BadRequestException } from '@nestjs/common';

// Fixed educational catalogue. Prices are authoritative integer paisa, never
// supplied by the browser. These fictional goods are not offered for sale.
export const SHOP_PRODUCTS = [
  { id: 'notebook', name: 'Padma Notebook', description: 'A cloth-bound notebook for your next big idea.', price_paisa: 35000, category: 'Stationery' },
  { id: 'mug', name: 'Dhaka Morning Mug', description: 'A ceramic companion for tea and study sessions.', price_paisa: 55000, category: 'Home' },
  { id: 'tote', name: 'Everyday Jute Tote', description: 'A lightweight woven bag inspired by Bangladesh.', price_paisa: 79000, category: 'Lifestyle' },
  { id: 'headphones', name: 'Study Session Headphones', description: 'An imaginary audio upgrade for your desk.', price_paisa: 185000, category: 'Electronics' },
  { id: 'tea', name: 'Sylhet Tea Collection', description: 'A fictional gift box inspired by the tea gardens.', price_paisa: 65000, category: 'Gifts' },
  { id: 'lamp', name: 'Evening Desk Lamp', description: 'A warm reading light for late-night inspiration.', price_paisa: 129000, category: 'Home' },
] as const;

export type ShopItem = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price_paisa: number;
  line_total_paisa: number;
};

export function normalizeCart(body: unknown): ShopItem[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Order must be a JSON object containing items');
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'items') || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20) {
    throw new BadRequestException('Provide 1–20 cart lines; prices and totals are set by the demo shop');
  }
  const quantities = new Map<string, number>();
  for (const candidate of input.items) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new BadRequestException('Each cart line requires product_id and quantity');
    }
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some(key => !['product_id', 'quantity'].includes(key)) ||
        typeof item.product_id !== 'string' || !SHOP_PRODUCTS.some(product => product.id === item.product_id) ||
        typeof item.quantity !== 'number' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new BadRequestException('Use a catalogue product with an integer quantity from 1 to 10');
    }
    const quantity = (quantities.get(item.product_id) ?? 0) + item.quantity;
    if (quantity > 10) throw new BadRequestException('At most 10 of each product can be ordered');
    quantities.set(item.product_id, quantity);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([product_id, quantity]) => {
    const product = SHOP_PRODUCTS.find(candidate => candidate.id === product_id)!;
    return { product_id, name: product.name, quantity, unit_price_paisa: product.price_paisa, line_total_paisa: product.price_paisa * quantity };
  });
}

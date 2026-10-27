import { ForbiddenException, Injectable } from '@nestjs/common';
import { pool } from '../db.js';
import { MerchantService } from '../merchant/merchant.service.js';
import { checkoutBaseUrl } from '../payments/payment-utils.js';
import { fields } from '../billing/billing-utils.js';
import { seedMerchantSamples } from './showcase-seed.js';
@Injectable()
export class ShowcaseService {
  constructor(private readonly merchants: MerchantService) {}
  async populate(cookie: string, body: unknown) {
    fields(body ?? {}, []);
    const merchant = await this.merchants.identity(cookie);
    if (merchant.status !== 'ACTIVE')
      throw new ForbiddenException(
        'Only active demo merchants can load examples',
      );
    return seedMerchantSamples(
      pool,
      merchant.id,
      checkoutBaseUrl(process.env.PAYBD_CHECKOUT_BASE_URL),
    );
  }
}

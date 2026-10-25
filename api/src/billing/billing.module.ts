import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module.js';
import { BillingService } from './billing.service.js';
import {
  BillingController,
  PublicLinksController,
} from './billing.controller.js';
@Module({
  imports: [MerchantModule],
  controllers: [BillingController, PublicLinksController],
  providers: [BillingService],
})
export class BillingModule {}

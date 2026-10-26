import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module.js';
import { FinanceService } from './finance.service.js';
import { FinanceController } from './finance.controller.js';
@Module({
  imports: [MerchantModule],
  providers: [FinanceService],
  controllers: [FinanceController],
  exports: [FinanceService],
})
export class FinanceModule {}

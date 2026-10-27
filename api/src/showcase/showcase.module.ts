import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module.js';
import { ShowcaseController } from './showcase.controller.js';
import { ShowcaseService } from './showcase.service.js';
@Module({
  imports: [MerchantModule],
  controllers: [ShowcaseController],
  providers: [ShowcaseService],
})
export class ShowcaseModule {}

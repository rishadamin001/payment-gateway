import { Module } from '@nestjs/common';
import { MerchantModule } from '../merchant/merchant.module.js';
import { OperationsService } from './operations.service.js';
import {
  OperationsController,
  DemoReceiverController,
} from './operations.controller.js';
@Module({
  imports: [MerchantModule],
  controllers: [OperationsController, DemoReceiverController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}

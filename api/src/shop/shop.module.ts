import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';

@Module({ imports: [PaymentsModule], controllers: [ShopController], providers: [ShopService] })
export class ShopModule {}

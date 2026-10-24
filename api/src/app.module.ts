import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PaymentsModule } from './payments/payments.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { ShopModule } from './shop/shop.module.js';
import { HttpErrorFilter } from './http-error.filter.js';

@Module({
  imports: [PaymentsModule, CheckoutModule, ShopModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_FILTER, useClass: HttpErrorFilter }],
})
export class AppModule {}

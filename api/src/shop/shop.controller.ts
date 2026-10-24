import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ShopService } from './shop.service.js';

@Controller('v1/shop')
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get('catalog')
  catalog() { return this.shop.catalog(); }

  @Post('orders')
  create(@Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    return this.shop.createOrder(authorization, key, body);
  }

  @Get('orders/:id')
  get(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    return this.shop.getOrder(authorization, id);
  }
}

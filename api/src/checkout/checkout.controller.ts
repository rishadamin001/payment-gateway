import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CheckoutService } from './checkout.service.js';

@Controller('v1/checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get(':id')
  get(@Param('id') id: string) { return this.checkout.get(id); }

  @Post(':id/challenge') @HttpCode(200)
  challenge(@Param('id') id: string, @Body() body: unknown) { return this.checkout.challenge(id, body); }

  @Post(':id/confirm') @HttpCode(200)
  confirm(@Param('id') id: string, @Body() body: unknown) { return this.checkout.confirm(id, body); }

  @Post(':id/cancel') @HttpCode(200)
  cancel(@Param('id') id: string, @Body() body: unknown) { return this.checkout.finish(id, body, 'CANCELLED'); }

  @Post(':id/expire') @HttpCode(200)
  expire(@Param('id') id: string, @Body() body: unknown) { return this.checkout.finish(id, body, 'EXPIRED'); }
}

import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { MerchantOriginGuard } from '../merchant/merchant.controller.js';
import { ShowcaseService } from './showcase.service.js';
@Controller('v1/merchant')
@UseGuards(MerchantOriginGuard)
export class ShowcaseController {
  constructor(private readonly service: ShowcaseService) {}
  @Post('demo-data') populate(
    @Headers('cookie') cookie: string,
    @Body() body: unknown,
  ) {
    return this.service.populate(cookie, body);
  }
}

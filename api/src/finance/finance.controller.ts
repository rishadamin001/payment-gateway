import {
  Controller,
  Get,
  Post,
  Headers,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { MerchantOriginGuard } from '../merchant/merchant.controller.js';
import { FinanceService } from './finance.service.js';
@Controller('v1/merchant/finance')
@UseGuards(MerchantOriginGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get() overview(@Headers('cookie') cookie: string) {
    return this.service.overview(cookie);
  }
  @Get('reconciliation') reconciliation(@Headers('cookie') cookie: string) {
    return this.service.reconciliation(cookie);
  }
  @Post('settlements') settle(
    @Headers('cookie') cookie: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.settle(cookie, key, body);
  }
  @Post('settlements/:id/payout') payout(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.payout(cookie, id, key, body);
  }
}

import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';

@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  listPayments(@Headers('authorization') authorization: string | undefined) {
    return this.paymentsService.listPayments(authorization);
  }

  @Post()
  createPayment(
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.paymentsService.createPayment(authorization, key, body);
  }

  @Get(':id')
  getPayment(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    return this.paymentsService.getPayment(authorization, id);
  }
}

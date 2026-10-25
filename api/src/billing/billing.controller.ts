import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MerchantOriginGuard } from '../merchant/merchant.controller.js';
import { BillingService } from './billing.service.js';
@Controller('v1/merchant')
@UseGuards(MerchantOriginGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}
  @Get('links') links(@Headers('cookie') cookie: string) {
    return this.service.links(cookie);
  }
  @Post('links') createLink(
    @Headers('cookie') cookie: string,
    @Body() body: unknown,
  ) {
    return this.service.createLink(cookie, body);
  }
  @Get('links/:id/qr') async qr(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const image = await this.service.qr(cookie, id);
    res.type('image/png').setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="paybd-link-${id}.png"`,
    );
    res.send(image);
  }
  @Get('invoices') invoices(@Headers('cookie') cookie: string) {
    return this.service.invoices(cookie);
  }
  @Post('invoices') createInvoice(
    @Headers('cookie') cookie: string,
    @Body() body: unknown,
  ) {
    return this.service.createInvoice(cookie, body);
  }
  @Get('invoices/:id') invoice(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    return this.service.invoice(cookie, id);
  }
  @Post('invoices/:id/send') send(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.send(cookie, id, body);
  }
  @Post('invoices/:id/remind') remind(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.remind(cookie, id, body);
  }
  @Get('invoices/:id/pdf') async pdf(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.service.pdf(cookie, id);
    res.type('application/pdf').setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="paybd-invoice-${id}.pdf"`,
    );
    res.send(pdf);
  }
}
@Controller('v1/pay')
export class PublicLinksController {
  constructor(private readonly service: BillingService) {}
  @Get(':id') get(@Param('id') id: string) {
    return this.service.publicLink(id);
  }
  @Post(':id/checkout') checkout(
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: unknown,
  ) {
    return this.service.checkout(id, key, body);
  }
}

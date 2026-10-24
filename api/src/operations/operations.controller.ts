import {
  Body,
  Controller,
  Get,
  Post,
  Headers,
  Param,
  UseGuards,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OperationsService } from './operations.service.js';
import { MerchantOriginGuard } from '../merchant/merchant.controller.js';
@Controller('v1/merchant')
@UseGuards(MerchantOriginGuard)
export class OperationsController {
  constructor(private readonly service: OperationsService) {}
  @Get('payments/:id/refunds') refunds(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    return this.service.refunds(cookie, id);
  }
  @Post('payments/:id/refunds') refund(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.refund(cookie, id, key, body);
  }
  @Get('webhooks') settings(@Headers('cookie') cookie: string) {
    return this.service.settings(cookie);
  }
  @Post('webhooks') configure(
    @Headers('cookie') cookie: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.configure(cookie, body);
  }
  @Get('webhooks/events') logs(@Headers('cookie') cookie: string) {
    return this.service.logs(cookie);
  }
  @Post('webhooks/events/:id/retry') retry(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
  ) {
    return this.service.retry(cookie, id);
  }
}
@Controller('v1/demo')
export class DemoReceiverController {
  constructor(private readonly service: OperationsService) {}
  @Post('webhook-receiver') @HttpCode(200) async receive(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const result = await this.service.receive(
      String(req.headers['x-paybd-event'] ?? ''),
      String(req.headers['x-paybd-timestamp'] ?? ''),
      String(req.headers['x-paybd-signature'] ?? ''),
      req.rawBody ?? Buffer.alloc(0),
    );
    if (result.status === 200 || result.status === 503)
      res.setHeader('X-PayBD-Verified', 'true');
    res
      .status(result.status)
      .json({ accepted: result.status === 200, test_mode: true });
  }
}

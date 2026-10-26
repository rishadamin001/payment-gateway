import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { MerchantOriginGuard } from '../merchant/merchant.controller.js';
import { AdminService } from './admin.service.js';

@Controller('v1/admin')
@UseGuards(MerchantOriginGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}
  private cookie(res: Response, token: string) {
    res.setHeader(
      'Set-Cookie',
      `paybd_admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}${process.env.PAYBD_WEB_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`,
    );
    res.setHeader('Cache-Control', 'no-store');
  }
  @Header('Cache-Control', 'no-store')
  @Get('setup-status')
  setupStatus() {
    return this.service.setupStatus();
  }
  @Post('setup') async setup(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.cookie(res, await this.service.setup(body));
    return { ok: true };
  }
  @Post('login') async login(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.cookie(res, await this.service.login(body));
    return { ok: true };
  }
  @Post('logout') async logout(
    @Headers('cookie') cookie: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.logout(cookie);
    this.cookie(res, '');
    return result;
  }
  @Header('Cache-Control', 'no-store')
  @Get('me')
  me(@Headers('cookie') cookie: string) {
    return this.service.identity(cookie);
  }
  @Header('Cache-Control', 'no-store')
  @Get('merchants')
  merchants(
    @Headers('cookie') cookie: string,
    @Query() query: Record<string, string>,
  ) {
    return this.service.merchants(cookie, query);
  }
  @Post('merchants/:id/status') merchantStatus(
    @Headers('cookie') cookie: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.merchantStatus(cookie, id, body);
  }
  @Header('Cache-Control', 'no-store')
  @Get('transactions')
  transactions(
    @Headers('cookie') cookie: string,
    @Query() query: Record<string, string>,
  ) {
    return this.service.transactions(cookie, query);
  }
  @Header('Cache-Control', 'no-store')
  @Get('risk')
  risk(@Headers('cookie') cookie: string) {
    return this.service.risk(cookie);
  }
  @Header('Cache-Control', 'no-store')
  @Get('audit')
  audit(
    @Headers('cookie') cookie: string,
    @Query() query: Record<string, string>,
  ) {
    return this.service.audit(cookie, query);
  }
}

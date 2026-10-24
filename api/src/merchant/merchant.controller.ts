import { Body, Controller, Get, Post, Headers, Query, Param, Res, UseGuards, Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Response, Request } from 'express';
import { MerchantService } from './merchant.service.js';
@Injectable()
export class MerchantOriginGuard implements CanActivate {
 canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<Request>();if(req.method==='GET')return true;const allowed=process.env.PAYBD_WEB_ORIGIN?[process.env.PAYBD_WEB_ORIGIN]:['http://localhost:3001','http://127.0.0.1:3001'];if(!allowed.includes(req.headers.origin??''))throw new ForbiddenException('Use the merchant website to submit this request');return true;}
}
@Controller('v1/merchant') @UseGuards(MerchantOriginGuard)
export class MerchantController {
 constructor(private readonly service:MerchantService){}
 private cookie(res:Response,token:string){res.setHeader('Set-Cookie',`paybd_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?28800:0}${process.env.PAYBD_WEB_ORIGIN?.startsWith('https:')?'; Secure':''}`);res.setHeader('Cache-Control','no-store');}
 @Post('signup') async signup(@Body() body:Record<string,unknown>,@Res({passthrough:true}) res:Response){this.cookie(res,await this.service.signup(body));return {ok:true};}
 @Post('login') async login(@Body() body:Record<string,unknown>,@Res({passthrough:true}) res:Response){this.cookie(res,await this.service.login(body));return {ok:true};}
 @Post('logout') async logout(@Headers('cookie') cookie:string,@Res({passthrough:true}) res:Response){const r=await this.service.logout(cookie);this.cookie(res,'');return r;}
 @Get('me') me(@Headers('cookie') cookie:string){return this.service.identity(cookie);}
 @Get('payments/export') async csv(@Headers('cookie') cookie:string,@Query() q:Record<string,string>,@Res() res:Response){res.type('text/csv').setHeader('Content-Disposition','attachment; filename="paybd-transactions.csv"');res.send(await this.service.list(cookie,q,true));}
 @Get('payments') list(@Headers('cookie') cookie:string,@Query() q:Record<string,string>){return this.service.list(cookie,q);}
 @Get('payments/:id') detail(@Headers('cookie') cookie:string,@Param('id') id:string){return this.service.detail(cookie,id);}
 @Post('demo-payment') demo(@Headers('cookie') cookie:string,@Headers('idempotency-key') key:string,@Body() body:unknown){return this.service.demo(cookie,key,body);}
 @Get('keys') keys(@Headers('cookie') cookie:string){return this.service.keys(cookie);}
 @Post('keys') create(@Headers('cookie') cookie:string){return this.service.createKey(cookie);}
 @Post('keys/:id/revoke') revoke(@Headers('cookie') cookie:string,@Param('id') id:string){return this.service.revokeKey(cookie,id);}
}

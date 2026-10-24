import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }
    // Never send/log raw PostgreSQL errors: they may include parameters or
    // connection information. Operational diagnostics should remain credential-free.
    console.error('PayBD request failed; check database connectivity and migrations.');
    response.status(500).json({ statusCode: 500, message: 'Unable to complete this demo request' });
  }
}

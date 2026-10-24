import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { pool } from './db.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    try {
      await pool.query('SELECT 1');
      return {
        status: 'ok',
        database: 'connected',
        demo_mode: true,
        notice: 'DEMO MODE: no real money',
      };
    } catch {
      return {
        status: 'error',
        database: 'unreachable',
        demo_mode: true,
        notice: 'DEMO MODE: no real money',
      };
    }
  }

  @Get('merchants')
  async merchants() {
    const result = await pool.query(
      'SELECT id, business_name, email, status, created_at FROM merchants ORDER BY created_at DESC',
    );
    return result.rows;
  }
}

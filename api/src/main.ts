import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { pool } from './db.js';
import { setupDocumentation } from './documentation/setup-documentation.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  setupDocumentation(app);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000, process.env.HOST ?? '127.0.0.1');
}
try {
  await bootstrap();
} catch {
  console.error(
    'PayBD startup failed. Check database connectivity and port availability.',
  );
  await pool.end();
  process.exitCode = 1;
}

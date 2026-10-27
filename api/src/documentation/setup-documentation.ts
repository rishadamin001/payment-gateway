import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export function setupDocumentation(app: INestApplication) {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.get('/openapi.json', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(openApiDocument);
  });
  server.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'PayBD Demo API — no real money',
      swaggerOptions: {
        supportedSubmitMethods: ['get'],
        persistAuthorization: false,
        validatorUrl: null,
        withCredentials: true,
      },
    }),
  );
}

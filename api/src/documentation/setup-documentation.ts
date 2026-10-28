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
  const html = swaggerUi.generateHTML(openApiDocument, {
      customSiteTitle: 'PayBD Demo API — no real money',
      swaggerOptions: {
        supportedSubmitMethods: ['get'],
        persistAuthorization: false,
        validatorUrl: null,
        withCredentials: true,
      },
    }).replace('<head>', '<head><base href="/docs/">');
  // Handle both slash forms before static middleware. The base keeps assets
  // correct when a hosting reverse proxy normalizes /docs/ to /docs.
  server.get('/docs', (_req, res) => res.type('html').send(html));
  server.use('/docs', swaggerUi.serve);
}

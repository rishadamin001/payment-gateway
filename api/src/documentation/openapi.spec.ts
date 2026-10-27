import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApiDocument } from './openapi.js';

function controllerFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? controllerFiles(path)
      : entry.name.endsWith('.controller.ts')
        ? [path]
        : [];
  });
}
describe('OpenAPI contract', () => {
  it('documents every declared Nest controller operation', () => {
    let count = 0;
    for (const file of controllerFiles(resolve('src'))) {
      let prefix = '';
      for (const match of readFileSync(file, 'utf8').matchAll(
        /@(Controller|Get|Post)\(\s*(?:['"]([^'"]*)['"]\s*)?\)/g,
      )) {
        if (match[1] === 'Controller') {
          prefix = match[2] ?? '';
          continue;
        }
        const path = (
          '/' + [prefix, match[2] ?? ''].filter(Boolean).join('/')
        ).replace(/:([a-z_]+)/gi, '{$1}');
        expect(
          openApiDocument.paths[path]?.[match[1].toLowerCase()],
          `${match[1]} ${path}`,
        ).toBeDefined();
        count++;
      }
    }
    expect(count).toBeGreaterThan(50);
  });
  it('keeps references resolvable and operation identifiers unique', () => {
    const ids = Object.values(openApiDocument.paths).flatMap((path) =>
      Object.values(path).map((operation) => operation.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref')
          expect(
            openApiDocument.components.schemas[
              String(child).split('/').at(-1)!
            ],
          ).toBeDefined();
        else visit(child);
      }
    };
    visit(openApiDocument);
  });
  it('describes authentication, integer money, binary documents and explicit checkout status codes', () => {
    expect(
      openApiDocument.components.securitySchemes.MerchantSession.name,
    ).toBe('paybd_session');
    expect(openApiDocument.components.securitySchemes.AdminSession.name).toBe(
      'paybd_admin_session',
    );
    expect(openApiDocument.components.securitySchemes.TestKey.scheme).toBe(
      'bearer',
    );
    const source = JSON.stringify(openApiDocument);
    expect(source).toContain('application/pdf');
    expect(source).toContain('image/png');
    expect(source).toContain('text/csv');
    expect(source).toContain('Idempotency-Key');
    expect(
      openApiDocument.paths['/v1/checkout/{id}/confirm'].post.responses,
    ).toHaveProperty('200');
    expect(openApiDocument.paths['/v1/payments'].post.responses).toHaveProperty(
      '201',
    );
  });
});

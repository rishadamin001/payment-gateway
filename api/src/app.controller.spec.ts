import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('Existing AppController root endpoint', () => {
  it('preserves the Hello World response', () => {
    const controller = new AppController(new AppService());
    expect(controller.getHello()).toBe('Hello World!');
  });
});

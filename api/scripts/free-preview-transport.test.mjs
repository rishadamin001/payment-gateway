import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openFreePreviewTunnel } from './free-preview-transport.mjs';

class FakeSocket extends EventEmitter {
  static instance;
  readyState = 1; sent = [];
  constructor(endpoint, options) { super(); this.endpoint = endpoint; this.options = options; FakeSocket.instance = this; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  terminate() { this.terminated = true; }
}
class FakeAgent { constructor(proxy) { this.proxy = proxy; } destroy() { this.destroyed = true; } }
const next = () => new Promise(done => setImmediate(done));
const options = { proxyUrl: 'http://proxy.example.test:8080', WebSocketClass: FakeSocket, AgentClass: FakeAgent, timeoutMs: 1000 };
async function assigned(extra = {}) {
  const promise = openFreePreviewTunnel({ ...options, ...extra });
  const socket = FakeSocket.instance;
  socket.emit('open');
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'hostnameAssigned', hostname: 'classroom.tunnelmole.net' })));
  return { tunnel: await promise, socket };
}
function request(socket, changes = {}) {
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'forwardedRequest', requestId: 'r1', url: '/invoice.pdf?download=1', method: 'POST', headers: { host: 'classroom.tunnelmole.net', origin: 'https://classroom.tunnelmole.net', cookie: 'fixture-session', 'content-type': 'application/json', connection: 'keep-alive,x-remove', 'x-remove': 'removed' }, body: Buffer.from('{"fictional":true}').toString('base64'), ...changes })));
}
test('uses fixed official service through explicit proxy and forwards binary data to fixed localhost only', async () => {
  let called;
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
  const { tunnel, socket } = await assigned({ fetchImpl: async (url, init) => { called = { url, init }; return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'set-cookie': 'test=value; Secure; HttpOnly', 'content-encoding': 'gzip' } }); } });
  assert.equal(socket.endpoint, 'wss://service.tunnelmole.com:8083');
  assert.equal(socket.options.agent.proxy, options.proxyUrl);
  assert.equal(socket.sent[0].type, 'initialise');
  request(socket); await next();
  assert.equal(called.url, 'http://127.0.0.1:10000/invoice.pdf?download=1');
  assert.equal(called.init.headers.host, 'classroom.tunnelmole.net');
  assert.equal(called.init.headers.origin, 'https://classroom.tunnelmole.net');
  assert.equal(called.init.headers.cookie, 'fixture-session');
  assert.equal(called.init.headers.connection, undefined);
  assert.equal(called.init.headers['x-remove'], undefined);
  assert.equal(called.init.redirect, 'manual');
  assert.equal(called.init.body.toString(), '{"fictional":true}');
  const response = socket.sent.at(-1);
  assert.deepEqual(Buffer.from(response.body, 'base64'), pdf);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.deepEqual(response.headers['set-cookie'], ['test=value; Secure; HttpOnly']);
  assert.equal(response.headers['content-encoding'], undefined);
  tunnel.close(); await tunnel.closed; assert.equal(socket.terminated, true);
});
test('rejects arbitrary targets, invalid hosts and oversized bodies without local fetch', async () => {
  let calls = 0;
  const { tunnel, socket } = await assigned({ fetchImpl: async () => { calls++; return new Response('bad'); } });
  for (const url of ['https://attacker.example/test', '//attacker.example/path', '/\\attacker.example', '/path\nsecret']) { request(socket, { url }); await next(); assert.equal(socket.sent.at(-1).statusCode, 400); }
  request(socket, { headers: { host: 'attacker.example' } }); await next(); assert.equal(socket.sent.at(-1).statusCode, 400);
  request(socket, { body: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }); await next(); assert.equal(socket.sent.at(-1).statusCode, 413);
  assert.equal(calls, 0); tunnel.close();
});
test('does not forward until local startup callback completes', async () => {
  let release, calls = 0;
  const promise = openFreePreviewTunnel({ ...options, onHostname: () => new Promise(done => { release = done; }), fetchImpl: async () => { calls++; return new Response('ready'); } });
  const socket = FakeSocket.instance;
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'hostnameAssigned', hostname: 'classroom.tunnelmole.net' })));
  request(socket); await next(); assert.equal(socket.sent.at(-1).statusCode, 503); assert.equal(calls, 0);
  release(); const tunnel = await promise;
  request(socket); await next(); assert.equal(calls, 1); tunnel.close();
});
test('restricts assigned hosts and sanitizes callback and network errors', async () => {
  for (const hostname of ['attacker.example', 'tunnelmole.net', 'https://classroom.tunnelmole.net', 'name.tunnelmole.net@attacker.example', 'a.b.tunnelmole.net']) {
    const promise = openFreePreviewTunnel(options); FakeSocket.instance.emit('message', Buffer.from(JSON.stringify({ type: 'hostnameAssigned', hostname })));
    await assert.rejects(promise, /hostname or local application/);
  }
  const failed = openFreePreviewTunnel({ ...options, onHostname: async () => { throw new Error('secret-fixture-must-not-escape'); } });
  FakeSocket.instance.emit('message', Buffer.from(JSON.stringify({ type: 'hostnameAssigned', hostname: 'classroom.tunnelmole.net' })));
  await assert.rejects(failed, error => !error.message.includes('secret-fixture'));
  const network = openFreePreviewTunnel(options); FakeSocket.instance.emit('error', new Error('proxy-credential-fixture'));
  await assert.rejects(network, error => error.message.includes('approved network policy') && !error.message.includes('credential'));
});
test('bounds startup and closes the connection; rejects direct connections', async () => {
  await assert.rejects(openFreePreviewTunnel({ ...options, proxyUrl: '' }), /direct connections are disabled/);
  const promise = openFreePreviewTunnel({ ...options, timeoutMs: 5 });
  await assert.rejects(promise, /timed out/);
  assert.equal(FakeSocket.instance.terminated, true);
  const closed = openFreePreviewTunnel(options); FakeSocket.instance.emit('close');
  await assert.rejects(closed, /closed the connection/);
});
test('caps local response bytes and reports a sanitized unavailable result', async () => {
  let cancelled = false;
  const { tunnel, socket } = await assigned({ fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < 17; i++) controller.enqueue(Buffer.alloc(1024 * 1024)); },
    cancel() { cancelled = true; },
  })) });
  request(socket); await next();
  assert.equal(socket.sent.at(-1).statusCode, 503);
  assert.equal(cancelled, true);
  tunnel.close();
});
test('rejects duplicate Host headers and replaces forwarding metadata while preserving foreign Origin', async () => {
  let calls = 0, forwarded;
  const { tunnel, socket } = await assigned({ fetchImpl: async (_url, init) => { calls++; forwarded = init.headers; return new Response('ok'); } });
  request(socket, { headers: { host: 'classroom.tunnelmole.net', Host: 'attacker.example' } });
  await next(); assert.equal(calls, 0); assert.equal(socket.sent.at(-1).statusCode, 400);
  request(socket, { headers: { host: 'classroom.tunnelmole.net', origin: 'https://attacker.example', 'x-forwarded-host': 'attacker.example', 'X-Forwarded-Proto': 'http', 'x-forwarded-for': 'spoofed', forwarded: 'host=attacker.example' } });
  await next();
  assert.equal(calls, 1);
  assert.equal(forwarded.origin, 'https://attacker.example');
  assert.equal(forwarded['x-forwarded-host'], 'classroom.tunnelmole.net');
  assert.equal(forwarded['x-forwarded-proto'], 'https');
  assert.equal(forwarded['x-forwarded-for'], undefined);
  assert.equal(forwarded.forwarded, undefined);
  tunnel.close();
});

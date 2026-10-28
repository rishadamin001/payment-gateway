// Optional temporary preview transport. Never connects except through the session proxy.
import { randomUUID } from 'node:crypto';

const endpoint = 'wss://service.tunnelmole.com:8083';
const local = 'http://127.0.0.1:10000';
const requestLimit = 2 * 1024 * 1024;
const responseLimit = 16 * 1024 * 1024;
const hop = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length']);

function cleanHeaders(input = {}) {
  const excluded = new Set(hop);
  const connection = Object.entries(input).find(([name]) => name.toLowerCase() === 'connection')?.[1];
  for (const name of String(connection ?? '').split(',')) excluded.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(input).filter(([name, value]) =>
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && !excluded.has(name.toLowerCase()) &&
    (typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))) &&
    !/[\r\n]/.test(String(value)),
  ));
}

function assignedOrigin(hostname) {
  if (typeof hostname !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.tunnelmole\.net$/i.test(hostname)) throw new Error('The preview service returned an invalid hostname.');
  return `https://${hostname.toLowerCase()}`;
}

/** Resolves after assignment and onHostname(origin) readiness. close() stops only this tunnel.
 * Dependency injection is for local tests; production always uses the fixed service/target.
 */
export async function openFreePreviewTunnel({
  onHostname = async () => {}, timeoutMs = 30000,
  proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
  WebSocketClass, AgentClass, fetchImpl = globalThis.fetch,
} = {}) {
  if (!proxyUrl) throw new Error('The preview requires the configured HTTPS proxy; direct connections are disabled.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) throw new Error('Invalid preview startup timeout.');
  try {
    const proxy = new URL(proxyUrl);
    if (!['http:', 'https:'].includes(proxy.protocol)) throw new Error();
  } catch { throw new Error('The configured preview proxy is invalid.'); }
  WebSocketClass ??= (await import('ws')).default;
  AgentClass ??= (await import('https-proxy-agent')).HttpsProxyAgent;
  const agent = new AgentClass(proxyUrl);
  let socket;
  try { socket = new WebSocketClass(endpoint, { agent, handshakeTimeout: timeoutMs, maxPayload: Math.ceil(requestLimit * 1.4) + 65536 }); }
  catch { agent.destroy?.(); throw new Error('The preview connection could not start through the configured proxy.'); }

  return new Promise((resolve, reject) => {
    let settled = false, closed = false, ready = false, origin = '', assigning = false, active = 0;
    let finishedClosing;
    const closedPromise = new Promise(done => { finishedClosing = done; });
    const pending = new Set();
    const timer = setTimeout(() => fail('The preview connection timed out. Check approved network access for the preview service.'), timeoutMs);
    function close() {
      if (closed) return;
      closed = true; ready = false; clearTimeout(timer);
      for (const controller of pending) controller.abort();
      try { socket.close(); socket.terminate?.(); } catch { /* already closed */ }
      agent.destroy?.();
      finishedClosing();
      if (!settled) { settled = true; reject(new Error('The preview connection closed before startup completed.')); }
    }
    function fail(message) {
      if (!settled) { settled = true; reject(new Error(message)); }
      close();
    }
    function send(message) {
      if (!closed && socket.readyState === 1) {
        try { socket.send(JSON.stringify(message)); } catch { close(); }
      }
    }
    function reply(message, statusCode, headers, body) {
      send({ type: 'forwardedResponse', requestId: message.requestId, url: message.url, statusCode, headers, body: body.toString('base64') });
    }
    function errorReply(message, statusCode, text) {
      reply(message, statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' }, Buffer.from(JSON.stringify({ message: text })));
    }
    async function forward(message) {
      if (typeof message.requestId !== 'string' || message.requestId.length > 200) return;
      if (!ready || active >= 32) { errorReply(message, 503, 'The demo preview is starting or busy. Retry shortly.'); return; }
      if (typeof message.url !== 'string' || message.url.length > 8192 || !message.url.startsWith('/') || message.url.startsWith('//') || /[\\\x00-\x20\x7f]/.test(message.url)) {
        errorReply(message, 400, 'Invalid preview request.'); return;
      }
      const target = new URL(message.url, local);
      if (target.origin !== local) { errorReply(message, 400, 'Invalid preview target.'); return; }
      const method = String(message.method || '').toUpperCase();
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) { errorReply(message, 405, 'Unsupported preview method.'); return; }
      const encoded = message.body ?? '';
      if (typeof encoded !== 'string' || encoded.length > Math.ceil(requestLimit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) { errorReply(message, 413, 'Preview request is too large or invalid.'); return; }
      const body = Buffer.from(encoded, 'base64');
      if (body.length > requestLimit || (['GET', 'HEAD'].includes(method) && body.length)) { errorReply(message, 413, 'Preview request body is not supported.'); return; }
      if (!message.headers || typeof message.headers !== 'object' || Array.isArray(message.headers) || Object.keys(message.headers).length > 100) { errorReply(message, 400, 'Invalid preview headers.'); return; }
      const headers = cleanHeaders(message.headers);
      if (Object.keys(message.headers).filter(name => name.toLowerCase() === 'host').length !== 1) { errorReply(message, 400, 'Invalid preview host.'); return; }
      // Keep browser Origin/Cookie, but require Host to match this assigned public site.
      const host = Object.entries(headers).find(([name]) => name.toLowerCase() === 'host')?.[1];
      if (host !== new URL(origin).host) { errorReply(message, 400, 'Invalid preview host.'); return; }
      for (const name of Object.keys(headers)) if (name.toLowerCase().startsWith('x-forwarded-') || name.toLowerCase() === 'forwarded') delete headers[name];
      headers['x-forwarded-proto'] = 'https';
      headers['x-forwarded-host'] = new URL(origin).host;
      const controller = new AbortController(); pending.add(controller); active++;
      const deadline = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetchImpl(target.toString(), { method, headers, ...(body.length ? { body } : {}), redirect: 'manual', signal: controller.signal });
        const chunks = []; let length = 0;
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > responseLimit) { await reader.cancel(); throw new Error(); }
            chunks.push(Buffer.from(chunk.value));
          }
        }
        const responseHeaders = cleanHeaders(Object.fromEntries(response.headers.entries()));
        // Fetch expands compressed bodies, so their original encoding/length no longer applies.
        delete responseHeaders['content-encoding'];
        const cookies = response.headers.getSetCookie?.() ?? [];
        if (cookies.length) responseHeaders['set-cookie'] = cookies;
        reply(message, response.status, responseHeaders, Buffer.concat(chunks));
      } catch { if (!closed) errorReply(message, 503, 'The local demo preview is unavailable. Retry shortly.'); }
      finally { clearTimeout(deadline); pending.delete(controller); active--; }
    }
    socket.on('open', () => send({ type: 'initialise', clientId: randomUUID(), connectionInfo: { isCli: false, isNpm: false, nodeVersion: process.version, tunnelmoleVersion: '2.4.0' } }));
    socket.on('error', () => fail('The proxy could not connect to the preview service. Check the approved network policy.'));
    socket.on('close', () => { if (!closed) fail('The preview service closed the connection.'); });
    socket.on('message', async data => {
      if (closed) return;
      let message;
      try { if (Buffer.byteLength(data) > Math.ceil(requestLimit * 1.4) + 65536) throw new Error(); message = JSON.parse(data.toString()); }
      catch { fail('The preview service sent an invalid message.'); return; }
      if (message?.type === 'hostnameAssigned') {
        if (assigning || origin) return;
        assigning = true;
        try {
          origin = assignedOrigin(message.hostname);
          await onHostname(origin);
          if (closed) return;
          ready = true; settled = true; clearTimeout(timer);
          resolve({ origin, close, closed: closedPromise });
        } catch { fail('The preview hostname or local application startup was invalid.'); }
      } else if (message?.type === 'forwardedRequest') await forward(message);
      else if (['invalidSubscription', 'tooManyDomains', 'hostnameAlreadyTaken', 'clientDisconnect'].includes(message?.type)) fail('The free preview service rejected or closed the session.');
    });
  });
}

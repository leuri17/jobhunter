import type { ServerResponse } from 'node:http';

/** Mirrors the `origin` allowlist registered in `server.ts`. */
const ALLOWED_ORIGIN = /^(http:\/\/localhost(:\d+)?|tauri:\/\/localhost)$/;

/**
 * Streams write straight to `reply.raw`, so `@fastify/cors`'s `onSend`
 * hook never runs and no `Access-Control-Allow-*` headers reach the
 * client. Without them the webview's `EventSource` raises `error` the
 * moment the stream opens, so callers must pass the request `Origin`
 * for the headers to be set.
 */
export function initSseHeaders(res: ServerResponse, origin?: string): void {
  if (origin !== undefined && ALLOWED_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

export function writeSseEvent<T>(res: ServerResponse, event: string, data: T): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

export function closeSse(res: ServerResponse): void {
  res.end();
}

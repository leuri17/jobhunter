import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { writeSseEvent, closeSse, initSseHeaders } from '../src/sse.js';

describe('sse helpers', () => {
  it('writes an event:data frame with two trailing newlines', () => {
    const res = new PassThrough() as unknown as import('node:http').ServerResponse;
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    writeSseEvent(res, 'progress', { foo: 1 });
    expect(Buffer.concat(chunks).toString()).toBe('event: progress\ndata: {"foo":1}\n\n');
  });

  it('initSseHeaders sets 200, text/event-stream, no-cache', () => {
    const res = {
      setHeader: (k: string, v: string) => {
        (res as Record<string, string>)[k] = v;
      },
    } as unknown as import('node:http').ServerResponse;
    initSseHeaders(res);
    const r = res as unknown as Record<string, string>;
    expect(r['Content-Type']).toBe('text/event-stream');
    expect(r['Cache-Control']).toBe('no-cache');
    expect(r['Connection']).toBe('keep-alive');
  });

  it('closeSse ends the stream', () => {
    let ended = false;
    const res = {
      end: () => {
        ended = true;
      },
    } as unknown as import('node:http').ServerResponse;
    closeSse(res);
    expect(ended).toBe(true);
  });
});

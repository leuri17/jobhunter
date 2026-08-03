import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../../src/logging/logger.js';

interface CapturedRecord {
  [key: string]: unknown;
}

function captureSink(): { stream: Writable; records: CapturedRecord[] } {
  const records: CapturedRecord[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        records.push(JSON.parse(line) as CapturedRecord);
      }
      callback();
    },
  });
  return { stream, records };
}

describe('createLogger', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-logger-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('emits records with level, time, component, and event', () => {
    const { stream, records } = captureSink();
    const logger = createLogger({ level: 'info', prettyTerminal: false }, { stdout: stream });

    logger.info({ component: 'config', event: 'loaded' }, 'configuration loaded');

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.level).toBe(30);
    expect(typeof record.time).toBe('number');
    expect(record.component).toBe('config');
    expect(record.event).toBe('loaded');
    expect(record.msg).toBe('configuration loaded');
  });

  it('respects the configured level', () => {
    const { stream, records } = captureSink();
    const logger = createLogger({ level: 'warn', prettyTerminal: false }, { stdout: stream });

    logger.info({ component: 'config', event: 'noop' }, 'should not appear');
    logger.warn({ component: 'config', event: 'warning' }, 'should appear');

    expect(records).toHaveLength(1);
    expect(records[0]!.event).toBe('warning');
  });

  it('redacts OpenAI API keys, raw prompts, and raw responses', () => {
    const { stream, records } = captureSink();
    const logger = createLogger({ level: 'info', prettyTerminal: false }, { stdout: stream });

    logger.info(
      {
        component: 'openai',
        event: 'request',
        apiKey: 'sk-very-secret-value',
        openai: { key: 'sk-other' },
        prompt: 'tell me about yourself',
        rawResponse: 'top-secret response',
      },
      'openai call',
    );

    const record = records[0]!;
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('sk-very-secret-value');
    expect(serialized).not.toContain('sk-other');
    expect(serialized).not.toContain('top-secret response');
    expect(serialized).toContain('[Redacted]');
    expect(serialized).toContain('openai call');
  });

  it('writes JSON-formatted lines to a file destination', async () => {
    const filePath = join(tempHome, 'app.log');
    const logger = createLogger(
      { level: 'info', prettyTerminal: false, filePath },
      { stdout: captureSink().stream },
    );

    logger.info({ component: 'config', event: 'persisted' }, 'wrote file');
    await new Promise((resolve) => setTimeout(resolve, 25));

    const contents = readFileSync(filePath, 'utf8').trim().split('\n');
    expect(contents).toHaveLength(1);
    const parsed = JSON.parse(contents[0]!);
    expect(parsed.component).toBe('config');
    expect(parsed.event).toBe('persisted');
  });

  it('child loggers inherit the parent redaction and level', () => {
    const { stream, records } = captureSink();
    const logger = createLogger({ level: 'info', prettyTerminal: false }, { stdout: stream });
    const child = logger.child({ component: 'scraper', runId: 'run-1' });

    child.info({ event: 'starting', apiKey: 'sk-very-secret-value' }, 'scraper begin');

    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.component).toBe('scraper');
    expect(record.runId).toBe('run-1');
    expect(record.event).toBe('starting');
    expect(record.msg).toBe('scraper begin');
    expect(JSON.stringify(record)).not.toContain('sk-very-secret-value');
  });
});

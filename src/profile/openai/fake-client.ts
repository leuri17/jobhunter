import type {
  OpenAIExtractionRawResponse,
  OpenAIExtractionRequest,
  OpenAIClient,
} from './types.js';

/**
 * Script entry for `FakeOpenAIClient`.
 *
 * Tests provide either a queue of `responses` (dequeued in order across
 * calls) or an `error` to reject the next call with. When the queue is
 * exhausted the client falls back to the last queued response (so retry
 * loops that retry past the second scripting entry still get a
 * deterministic value). `delayMs` optionally stalls the resolution by
 * the given number of milliseconds so the caller can exercise retry
 * timing without sleeping the whole test process.
 */
export interface FakeOpenAIClientScript {
  readonly responses?: readonly OpenAIExtractionRawResponse[];
  readonly error?: Error;
  readonly delayMs?: number;
}

/**
 * Deterministic `OpenAIClient` for tests.
 *
 * The constructor accepts either a single script (reused for every call —
 * the `responses` array is a queue consumed across calls) or an array of
 * scripts (each script consumed by one call). All `extract` calls are
 * recorded in `requests` so the test can assert what the production
 * service sent.
 */
export class FakeOpenAIClient implements OpenAIClient {
  readonly requests: OpenAIExtractionRequest[];
  private readonly scripts: FakeOpenAIClientScript[];
  private scriptIndex = 0;
  private readonly scriptCursor: number[];

  constructor(script: FakeOpenAIClientScript | readonly FakeOpenAIClientScript[]) {
    this.requests = [];
    this.scripts = Array.isArray(script) ? [...script] : [script];
    this.scriptCursor = this.scripts.map(() => 0);
  }

  async extract(request: OpenAIExtractionRequest): Promise<OpenAIExtractionRawResponse> {
    this.requests.push(request);

    let index: number;
    if (this.scriptIndex < this.scripts.length) {
      index = this.scriptIndex;
      this.scriptIndex += 1;
    } else {
      // No more entries — fall back to the last script so retry loops past
      // the queue length still get a deterministic value.
      index = this.scripts.length - 1;
    }
    const script = this.scripts[index]!;
    const cursor = this.scriptCursor[index]!;

    if (script.delayMs && script.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, script.delayMs));
    }

    if (script.error) {
      throw script.error;
    }

    const responses = script.responses ?? [];
    if (responses.length === 0) {
      throw new Error('FakeOpenAIClient: script has no responses and no error.');
    }

    const responseIndex = Math.min(cursor, responses.length - 1);
    this.scriptCursor[index] = cursor + 1;
    return responses[responseIndex]!;
  }

  getRequestCount(): number {
    return this.requests.length;
  }
}

const BUILTIN_PATTERNS: ReadonlyArray<{ name: string; match: RegExp; replace: string }> = [
  { name: 'bearer', match: /Bearer\s+[A-Za-z0-9._-]+/g, replace: 'Bearer [REDACTED:token]' },
  {
    name: 'qs',
    match: /([?&])(api_?key|access_?token|password|secret)=([^&\s]+)/gi,
    replace: '$1$2=[REDACTED]',
  },
  {
    name: 'kv',
    match: /(api[_-]?key|apikey|password|secret|token)[\s"':=]+(?!\s*\[REDACTED)[^\s"',}{]+/gi,
    replace: '[REDACTED:$1]',
  },
  {
    name: 'linkedin-cookie',
    match: /\b(?:li_at|li_aq|JSESSIONID|csrfToken|_csrf)\s*[=:]\s*[A-Za-z0-9._-]+/g,
    replace: '[REDACTED:cookie]',
  },
  {
    name: 'email',
    match: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: '[REDACTED:email]',
  },
  {
    name: 'set-cookie',
    match: /Set-Cookie:\s*[^\r\n]+/gi,
    replace: 'Set-Cookie: [REDACTED]',
  },
  {
    name: 'openai-key',
    match: /\bsk-[A-Za-z0-9]{20,}\b/g,
    replace: '[REDACTED:openai-key]',
  },
];

const SENSITIVE_KEYS = /^(api_?key|apikey|password|secret|token|access_?token|authorization|cookie)$/i;

export interface RedactionPattern {
  readonly name: string;
  readonly match: RegExp;
  readonly replace: string;
}

export interface RedactorOptions {
  readonly extraPatterns?: readonly RedactionPattern[];
}

export class Redactor {
  private readonly patterns: ReadonlyArray<RedactionPattern>;

  constructor(options: RedactorOptions = {}) {
    this.patterns = [...BUILTIN_PATTERNS, ...(options.extraPatterns ?? [])];
  }

  redactString(value: string): string {
    let out = value;
    for (const { match, replace } of this.patterns) {
      out = out.replace(match, replace);
    }
    return out;
  }

  redactValue<T>(value: T): T {
    return this.walk(value, new WeakSet()) as T;
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || typeof value !== 'object') {
      return typeof value === 'string' ? this.redactString(value) : value;
    }
    if (seen.has(value as object)) return value;
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.map((entry) => this.walk(entry, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = this.walk(v, seen);
      }
    }
    return out;
  }
}

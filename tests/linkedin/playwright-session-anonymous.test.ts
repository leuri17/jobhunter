import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sessionSrc = readFileSync(
  resolve(__dirname, '../../src/linkedin/playwright-session.ts'),
  'utf8',
);

describe('playwright-session.ts anonymous-context invariant', () => {
  it('does not call addCookies, setCookie, or storageState', () => {
    expect(sessionSrc).not.toMatch(/\baddCookies\s*\(/);
    expect(sessionSrc).not.toMatch(/\bsetCookie\s*\(/);
    expect(sessionSrc).not.toMatch(/\bstorageState\s*[:=]/);
    expect(sessionSrc).not.toMatch(/\buserDataDir\s*[:=]/);
    expect(sessionSrc).not.toMatch(/\baddInitScript\s*\(/);
    expect(sessionSrc).not.toMatch(/\bsetExtraHTTPHeaders\s*\(/);
  });

  it('does not pass li_at, li_aq, JSESSIONID, csrfToken, or _csrf as values', () => {
    expect(sessionSrc).not.toMatch(/li_at\s*[:=]/);
    expect(sessionSrc).not.toMatch(/li_aq\s*[:=]/);
    expect(sessionSrc).not.toMatch(/JSESSIONID\s*[:=]/);
    expect(sessionSrc).not.toMatch(/csrfToken\s*[:=]/);
    expect(sessionSrc).not.toMatch(/_csrf\s*[:=]/);
  });

  it('serviceWorkers is set to block', () => {
    expect(sessionSrc).toMatch(/serviceWorkers:\s*['"]block['"]/);
  });
});

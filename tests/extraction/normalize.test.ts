import { describe, expect, it } from 'vitest';

import { isValidRequiredField, normalizeText } from '../../src/linkedin/extraction/normalize.js';

/**
 * Tests for `src/linkedin/extraction/normalize.ts`
 * (TASK-013 Plan Task 3). Linkedom-free; pure string manipulation.
 *
 * Mirrors the test plan from §Wave A in the plan file:
 *   - empty input → ''
 *   - simple tag dropping
 *   - script/style block dropping
 *   - "Show more" / "See more" / "View more" literal stripping
 *   - block-level tags preserved as word boundaries
 *   - common HTML entities decoded
 *   - whitespace collapsed
 *   - isValidRequiredField for null / whitespace / non-empty input
 */
describe('src/linkedin/extraction/normalize — Wave A', () => {
  describe('normalizeText', () => {
    it('returns the empty string for empty input', () => {
      expect(normalizeText('')).toBe('');
    });

    it('returns the empty string for a non-string input', () => {
      // Defensive: callers pass through Zod-parsed strings but the
      // function should never throw on unexpected input.
      expect(normalizeText(null as unknown as string)).toBe('');
      expect(normalizeText(undefined as unknown as string)).toBe('');
      expect(normalizeText(42 as unknown as string)).toBe('');
    });

    it('strips a single paragraph tag', () => {
      expect(normalizeText('<p>Hello</p>')).toBe('Hello');
    });

    it('preserves a space between consecutive paragraph tags', () => {
      expect(normalizeText('<p>Hello</p><p>World</p>')).toBe('Hello World');
    });

    it('drops <script> blocks entirely', () => {
      expect(normalizeText('<script>alert(1)</script>Real content')).toBe('Real content');
    });

    it('drops <style> blocks entirely', () => {
      expect(normalizeText('<style>body { color: red; }</style>Visible')).toBe('Visible');
    });

    it('drops <button> blocks (including the "Show more" literal)', () => {
      expect(normalizeText('<button>Show more</button>Content')).toBe('Content');
    });

    it('drops <noscript> blocks', () => {
      expect(normalizeText('<noscript>JS required</noscript>Real')).toBe('Real');
    });

    it('preserves paragraph boundaries in the About / Responsibilities example', () => {
      const out = normalizeText('<p>About the job.</p><p>Responsibilities...</p>');
      // The block-level tags are converted to spaces — the output
      // contains a space between the two sentences.
      expect(out).toBe('About the job. Responsibilities...');
      expect(out).toContain(' ');
    });

    it('preserves list-item boundaries with a space between items', () => {
      expect(normalizeText('<li>One</li><li>Two</li>')).toBe('One Two');
    });

    it('decodes the &nbsp; entity to a space and trims it', () => {
      expect(normalizeText('&nbsp;Hello&nbsp;')).toBe('Hello');
    });

    it('decodes the &amp; entity', () => {
      expect(normalizeText('A &amp; B')).toBe('A & B');
    });

    it('decodes &lt; / &gt; / &quot; / &#39; entities', () => {
      expect(normalizeText('&lt;tag&gt;')).toBe('<tag>');
      expect(normalizeText('&quot;hi&quot;')).toBe('"hi"');
      expect(normalizeText('it&#39;s')).toBe("it's");
    });

    it('strips the "Show more" literal case-insensitively', () => {
      expect(normalizeText('Description text. Show more')).toBe('Description text.');
      expect(normalizeText('Description text. SHOW MORE.')).toBe('Description text.');
      expect(normalizeText('Description text. show more')).toBe('Description text.');
    });

    it('strips the "See more" literal case-insensitively', () => {
      expect(normalizeText('Description text. See more')).toBe('Description text.');
      expect(normalizeText('Description text. SEE MORE')).toBe('Description text.');
    });

    it('strips the "View more" literal case-insensitively', () => {
      expect(normalizeText('Description text. View more')).toBe('Description text.');
    });

    it('does not strip substrings inside other words', () => {
      // "show" alone or "moreshow" must NOT trigger the regex.
      expect(normalizeText('A showcase of skills')).toBe('A showcase of skills');
      expect(normalizeText('moreshow inside')).toBe('moreshow inside');
    });

    it('collapses repeated whitespace (including newlines and tabs) to a single space', () => {
      expect(normalizeText('a\n\n\tb   c')).toBe('a b c');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeText('   hello   ')).toBe('hello');
    });

    it('returns the empty string for input that is only whitespace + tags', () => {
      expect(normalizeText('<p>   </p>')).toBe('');
      expect(normalizeText('<button>Show more</button>')).toBe('');
    });

    it('handles nested tags', () => {
      expect(normalizeText('<div><p>Hello <strong>World</strong></p></div>')).toBe('Hello World');
    });

    it('handles a realistic LinkedIn description snippet', () => {
      const html = `
        <div class="jobs-description-content__text">
          <p>About the job</p>
          <p>We are looking for a Senior Engineer to join our team.</p>
          <button class="show-more-less-html__button--more">Show more</button>
          <p>Responsibilities:</p>
          <ul><li>Build features</li><li>Review PRs</li></ul>
        </div>
      `;
      const out = normalizeText(html);
      expect(out).toContain('About the job');
      expect(out).toContain('We are looking for a Senior Engineer to join our team.');
      expect(out).toContain('Responsibilities:');
      expect(out).toContain('Build features');
      expect(out).toContain('Review PRs');
      expect(out).not.toContain('Show more');
      expect(out).not.toContain('show-more-less');
    });
  });

  describe('isValidRequiredField', () => {
    it('returns false for null', () => {
      expect(isValidRequiredField(null)).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isValidRequiredField('')).toBe(false);
    });

    it('returns false for a whitespace-only string', () => {
      expect(isValidRequiredField('   ')).toBe(false);
    });

    it('returns false for an HTML-only string that normalizes to empty', () => {
      expect(isValidRequiredField('<p>   </p>')).toBe(false);
      expect(isValidRequiredField('<button>Show more</button>')).toBe(false);
    });

    it('returns true for a non-empty string', () => {
      expect(isValidRequiredField('Hello')).toBe(true);
    });

    it('returns true for HTML with text inside', () => {
      expect(isValidRequiredField('<p>Hello</p>')).toBe(true);
    });

    it('returns false for a non-string input', () => {
      // Defensive: per the function signature the input must be
      // string | null — but the function should not throw on
      // unexpected types.
      expect(isValidRequiredField(42 as unknown as string | null)).toBe(false);
      expect(isValidRequiredField(undefined as unknown as string | null)).toBe(false);
    });
  });
});

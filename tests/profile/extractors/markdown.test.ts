import { describe, expect, it } from 'vitest';

import { MarkdownExtractor } from '../../../src/profile/extractors/markdown.js';

describe('MarkdownExtractor', () => {
  it('preserves Markdown content as-is', async () => {
    const extractor = new MarkdownExtractor();
    const md = '# Title\n\n- item 1\n- item 2\n';
    const result = await extractor.extract(new TextEncoder().encode(md));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toBe(md);
      expect(result.warnings).toEqual([]);
    }
  });

  it('preserves YAML front-matter as plain text', async () => {
    const extractor = new MarkdownExtractor();
    const md = '---\ntitle: CV\ntags: [a, b]\n---\n\nHello\n';
    const result = await extractor.extract(new TextEncoder().encode(md));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.text).toBe(md);
    }
  });

  it('records a warning when external image references are present', async () => {
    const extractor = new MarkdownExtractor();
    const md = '# Title\n\n![avatar](https://example.com/me.png)\n';
    const result = await extractor.extract(new TextEncoder().encode(md));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.warnings).toContain('markdown_contains_external_image_references');
    }
  });

  it('does not warn for relative image references', async () => {
    const extractor = new MarkdownExtractor();
    const md = '![avatar](images/me.png)\n';
    const result = await extractor.extract(new TextEncoder().encode(md));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.warnings).toEqual([]);
    }
  });
});

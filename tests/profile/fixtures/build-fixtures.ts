// Generate three PDF fixtures used by the profile extractor tests.
//
// Run with: pnpm tsx tests/profile/fixtures/build-fixtures.ts
//
// This produces:
//   - text-pdf.pdf       a text-based PDF containing the literal "Hello JobHunter"
//   - image-only.pdf     a PDF that has no extractable text (image-only simulation)
//   - malformed.pdf      bytes that pdf-parse will reject
//
// The fixtures are committed to disk so the tests do not depend on pdf-parse being
// able to write PDFs; pdf-parse only reads them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { build, logTable } from './pdf-encoder.js';

const OUT_DIR = dirname(new URL(import.meta.url).pathname);

function writeTextPdf(): void {
  const bytes = build({
    pageContent: 'BT /F1 12 Tf 100 700 Td (Hello JobHunter) Tj ET',
  });
  writeFileSync(resolve(OUT_DIR, 'text-pdf.pdf'), bytes);
}

function writeImageOnlyPdf(): void {
  // A page that contains only a graphic (no text operators). pdf-parse will
  // return an empty string for `text`, which our extractor maps to ocr_required.
  const bytes = build({
    pageContent: '0 0 612 792 re f',
  });
  writeFileSync(resolve(OUT_DIR, 'image-only.pdf'), bytes);
}

function writeMalformedPdf(): void {
  // Random bytes that start with the PDF magic header but contain no parseable structure.
  const garbage = Buffer.from([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  ]);
  writeFileSync(resolve(OUT_DIR, 'malformed.pdf'), garbage);
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeTextPdf();
  writeImageOnlyPdf();
  writeMalformedPdf();
  logTable('Generated PDF fixtures in', OUT_DIR);
}

main();

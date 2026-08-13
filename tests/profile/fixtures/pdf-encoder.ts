// Minimal PDF builder used by the fixture generator. Produces tiny, valid PDFs
// that pdf-parse can read. Not intended for production use.

const HEADER = '%PDF-1.4\n';
const FOOTER = '%%EOF\n';

interface BuildOptions {
  readonly pageContent: string;
}

export function build(options: BuildOptions): Buffer {
  const objects: string[] = [];

  // 1. Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2. Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  // 3. Page
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );

  // 4. Contents stream
  const stream = options.pageContent;
  const length = Buffer.byteLength(stream, 'latin1');
  objects.push(`4 0 obj\n<< /Length ${length} >>\nstream\n${stream}\nendstream\nendobj\n`);

  // 5. Font
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Compute xref offsets
  const chunks: Buffer[] = [Buffer.from(HEADER, 'latin1')];
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(Buffer.concat(chunks).byteLength);
    chunks.push(Buffer.from(object, 'latin1'));
  }

  const xrefStart = Buffer.concat(chunks).byteLength;
  const xref = buildXref(offsets, objects.length);
  chunks.push(Buffer.from(xref, 'latin1'));

  const trailerStart = Buffer.concat(chunks).byteLength;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n${FOOTER}`;
  chunks.push(Buffer.from(trailer, 'latin1'));

  const final = Buffer.concat(chunks);
  // Silence unused-trailer-start warning for tooling that inspects the var.
  void trailerStart;
  return final;
}

function buildXref(offsets: readonly number[], objectCount: number): string {
  const lines: string[] = ['xref'];
  lines.push(`0 ${objectCount + 1}`);
  lines.push('0000000000 65535 f ');
  for (const offset of offsets) {
    lines.push(`${offset.toString().padStart(10, '0')} 00000 n `);
  }
  return lines.join('\n') + '\n';
}

export function logTable(label: string, value: string): void {
  console.log(`${label} ${value}`);
}

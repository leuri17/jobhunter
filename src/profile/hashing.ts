import { createHash } from 'node:crypto';

export type ByteStream = AsyncIterable<Uint8Array> | NodeJS.ReadableStream;

export function hashString(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function hashFileContents(stream: ByteStream): Promise<string> {
  const hasher = createHash('sha256');
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
}

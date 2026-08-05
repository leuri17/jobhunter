import type { ZodType } from 'zod';

import { DatabaseError } from '../errors.js';

export interface JsonColumnCodec<T> {
  encode(value: T): string;
  decode(raw: string | null): T | null;
  decodeRequired(raw: string | null): T;
}

export function jsonColumn<T>(schema: ZodType<T>): JsonColumnCodec<T> {
  return {
    encode(value: T): string {
      return JSON.stringify(value);
    },
    decode(raw: string | null): T | null {
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = schema.safeParse(parsed);
        if (!result.success) {
          throw new DatabaseError(
            'persisted_json_invalid',
            'Persisted JSON column failed schema validation.',
            { issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) },
          );
        }
        return result.data;
      } catch (cause) {
        if (cause instanceof DatabaseError) throw cause;
        throw new DatabaseError(
          'persisted_json_invalid',
          'Persisted JSON column could not be parsed.',
          { raw },
          cause instanceof Error ? cause : undefined,
        );
      }
    },
    decodeRequired(raw: string | null): T {
      const decoded = this.decode(raw);
      if (decoded === null) {
        throw new DatabaseError('persisted_json_missing', 'Required JSON column was null.', { raw: null });
      }
      return decoded;
    },
  };
}

// Re-export z for downstream repositories that build schemas.
export { z } from 'zod';

import { ApplicationError } from '@jobhunter/core/errors';

export function statusFor(error: unknown): number {
  if (error instanceof ApplicationError) {
    switch (error.exitCode) {
      case 2:
        return 400;
      case 3:
        return 404;
      case 4:
        return 409;
      case 5:
        return 502;
      default:
        return error.exitCode >= 100 && error.exitCode < 600 ? error.exitCode : 500;
    }
  }
  return 500;
}

export function envelopeFor(error: unknown): Record<string, unknown> {
  if (error instanceof ApplicationError) {
    return {
      schemaVersion: 1,
      error: {
        code: error.code,
        message: error.message,
        details: error.metadata ?? null,
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    schemaVersion: 1,
    error: { code: 'internal_error', message, details: null },
  };
}

import { ApplicationError, ExitCode } from '@jobhunter/core/errors';

// Nginx convention: 499 Client Closed Request = the client disconnected
// before the server finished. Used for `ExitCode.UserCancellation` (130),
// which would otherwise map to HTTP 130 (informational, unparseable by
// most clients).
const CLIENT_CLOSED_REQUEST = 499;

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
      case ExitCode.UserCancellation:
        return CLIENT_CLOSED_REQUEST;
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
  // Non-`ApplicationError`: never leak raw message text to the client.
  // Log the full error server-side for diagnostics; return a generic
  // envelope to the caller.
  process.stderr.write(`sidecar: internal_error (non-ApplicationError): ${String(error)}\n`);
  if (error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`);
  }
  return {
    schemaVersion: 1,
    error: { code: 'internal_error', message: 'Internal server error', details: null },
  };
}

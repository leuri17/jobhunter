import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class RecordNotFoundError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/**
 * Raised by `ProfileSourceRepository.insert` when the SHA-256 hash already
 * exists in `profile_sources`. The repository layer is now strict INSERT-OR-ERROR;
 * SHA-256 deduplication is owned by `ProfileImportService` (which calls
 * `findBySha256` before `insert`). This error should only surface if a caller
 * bypasses the service or a race occurs after the service's lookup.
 */
export class DuplicateSha256Error extends ApplicationError {
  constructor(sha256: string, cause?: Error) {
    super(
      'duplicate_sha256',
      `A profile_source with sha256 "${sha256}" already exists.`,
      ExitCode.Fatal,
      { sha256 },
      cause,
    );
  }
}

export { ApplicationError, ExitCode };

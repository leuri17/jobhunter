import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
} from '../errors/application-error.js';

export class ProfileImportError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class UnsupportedSourceFormatError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('unsupported_format', message, metadata, cause);
  }
}

export class SourceUnreadableError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('source_unreadable', message, metadata, cause);
  }
}

export class ExtractionFailedError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('extraction_failed', message, metadata, cause);
  }
}

export class OcrRequiredError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('ocr_required', message, metadata, cause);
  }
}

export class InvalidArgumentCountError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('invalid_argument_count', message, metadata, cause);
  }
}

export class ProfileSourceStorageError extends ProfileImportError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('profile_source_storage_error', message, metadata, cause);
  }
}

/**
 * Base class for errors raised by the profile review / editing / approval /
 * rejection lifecycle. Accepts an explicit exit
 * code so subclasses can pick the documented failure-class mapping.
 *
 * The subclass hierarchy mirrors the four failure surfaces the CLI can hit:
 *   - invalid identifier / payload / state         → InvalidUsage (2)
 *   - unresolved blocking conflicts               → InvalidUsage (2)
 *   - user-cancelled approval / rejection         → UserCancellation (130)
 */
export class ProfileLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ApplicationError['exitCode'],
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

export class InvalidProfileIdentifierError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.InvalidUsage, metadata);
  }
}

export class InvalidProfilePayloadError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.InvalidUsage, metadata);
  }
}

export class InvalidProfileStateError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.InvalidUsage, metadata);
  }
}

export class BlockingConflictsUnresolvedError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.InvalidUsage, metadata);
  }
}

export class UserCancelledApprovalError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.UserCancellation, metadata);
  }
}

export class UserCancelledRejectionError extends ProfileLifecycleError {
  constructor(code: string, message: string, metadata: ApplicationErrorMetadata = {}) {
    super(code, message, ExitCode.UserCancellation, metadata);
  }
}

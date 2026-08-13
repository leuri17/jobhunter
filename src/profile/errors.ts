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

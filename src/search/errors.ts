import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
} from '../errors/application-error.js';

export class SearchConfigError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class SearchCancelledError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.UserCancellation, metadata, cause);
  }
}

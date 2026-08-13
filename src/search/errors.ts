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

export class LinkedInURLParseError extends SearchConfigError {
  constructor(url: string, reason: string, metadata: ApplicationErrorMetadata = {}) {
    super('invalid_linkedin_url', `Cannot use LinkedIn URL "${url}": ${reason}.`, {
      url,
      reason,
      ...metadata,
    });
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

import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class InvalidIdentifierError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export { ApplicationError, ExitCode };

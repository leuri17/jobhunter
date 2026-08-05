import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class DatabaseError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export class MigrationError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export { ApplicationError, ExitCode };

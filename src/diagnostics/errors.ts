import { ApplicationError, ExitCode } from '../errors/application-error.js';

export class DiagnosticError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export class MissingBrowserImplementationError extends DiagnosticError {
  constructor(
    code: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
  }
}

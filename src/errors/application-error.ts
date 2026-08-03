export const ExitCode = {
  Success: 0,
  Fatal: 1,
  InvalidUsage: 2,
  MissingRequired: 3,
  LinkedInBlocked: 4,
  OpenAIFailure: 5,
  UserCancellation: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface ApplicationErrorMetadata {
  readonly [key: string]: unknown;
}

export interface ApplicationErrorJSON {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly exitCode: ExitCodeValue;
  readonly metadata: ApplicationErrorMetadata;
  readonly cause?: { name: string; message: string };
}

export class ApplicationError extends Error {
  readonly code: string;
  readonly exitCode: ExitCodeValue;
  readonly metadata: ApplicationErrorMetadata;
  override readonly cause?: Error;

  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
    this.metadata = metadata;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }

  toJSON(): ApplicationErrorJSON {
    const json: ApplicationErrorJSON = {
      name: this.name,
      code: this.code,
      message: this.message,
      exitCode: this.exitCode,
      metadata: this.metadata,
    };
    if (this.cause !== undefined) {
      return { ...json, cause: { name: this.cause.name, message: this.cause.message } };
    }
    return json;
  }
}

export class PathError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

export class ConfigError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class ValidationError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class UnknownConfigError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

export class LogConfigError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

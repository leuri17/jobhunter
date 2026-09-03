/**
 * Public barrel for `src/errors/`.
 *
 * Re-exports the typed error hierarchy and stable exit-code mapping.
 * Domain code throws `ApplicationError` subclasses; the desktop shell
 * (and the sidecar's HTTP error mapper) translate them into HTTP
 * status responses via this surface.
 */

export {
  ExitCode,
  ApplicationError,
  PathError,
  ConfigError,
  ValidationError,
  UnknownConfigError,
  LogConfigError,
  type ExitCodeValue,
  type ApplicationErrorMetadata,
  type ApplicationErrorJSON,
} from './application-error.js';

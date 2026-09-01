# Security

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/leuri17/jobhunter/security/advisories/new).
You should receive an acknowledgement within a reasonable window.

## Supported versions

Only the current `main` branch is supported. JobHunter is an MVP; there
are no backports for older versions.

## Scope

A security issue is anything that touches:

- LinkedIn authentication, credential storage, or login automation.
- OpenAI API key handling or request persistence.
- Local SQLite database integrity, profile source storage, or diagnostic artifacts.
- The public-anonymous access model — JobHunter must only read public,
  unauthenticated LinkedIn pages; never log in, store credentials, or
  bypass rate limits.
- Path resolution (anything that escapes the OS-specific application
  directories defined under [Configuration](./docs/architecture.md)).

## Out of scope

- General feature requests (use the GitHub issue tracker).
- LinkedIn ToS / misuse reports (use
  [`docs/responsible-use.md`](./docs/responsible-use.md)'s reporting channel).

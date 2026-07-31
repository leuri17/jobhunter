# TASK-001 — Repository and TypeScript Foundation

**Status:** Planned; not approved for implementation
**Order:** 001
**Dependencies:** None

## Scope

Establish the smallest runnable JobHunter repository without implementing product behavior. This task owns project metadata and development tooling only:

- Pin Node.js `24.18.0` and pnpm `11.18.0`.
- Create the native-ESM TypeScript project configuration required by the specification.
- Configure strict compilation, source maps, declarations, `src/` input, and `dist/` output.
- Establish the Commander.js CLI entrypoint and `--help` plumbing without implementing application commands.
- Establish the Vitest test harness and normal/live test separation.
- Add only the direct dependencies approved by the foundation task plan.
- Add shared project scripts for type checking, building, testing, coverage, and explicitly opted-in live tests.
- Add repository-safe ignore rules and minimal developer setup documentation only where needed by this task.

Product behavior, database schema, migrations, operational paths, and user workflows are out of scope.

## Dependencies and handoffs

- No prior JobHunter task is required.
- Produces the package/build/test conventions consumed by every later task.
- Later tasks must not bypass the configured TypeScript and test entrypoints.

## Referenced specification sections

- `SPEC.md` §5.1 Runtime and package manager
- `SPEC.md` §5.2 TypeScript build and module configuration
- `SPEC.md` §5.3 CLI and prompting
- `SPEC.md` §5.8 Testing
- `SPEC.md` §43.1–43.3 Development workflow
- `GIT.md` §7–§8 for tracked and ignored project files

## Expected tests

- Verify package metadata declares the required engine range, package manager, and ESM mode.
- Verify TypeScript accepts a strict NodeNext configuration with the required output settings.
- Verify the CLI can render help without creating runtime data directories.
- Verify Vitest runs a minimal repository test and excludes live tests from the normal command.
- Verify the build output is emitted under `dist/` with source maps and declarations.

## Verification requirements

- Confirm `node --version` reports `v24.18.0` and `pnpm --version` reports `11.18.0` in the implementation environment.
- Run the task-specific dependency installation with the committed lockfile.
- Run the configured typecheck, build, normal test, and live-test discovery commands.
- Run the CLI help smoke check from a clean temporary home-directory environment.
- Confirm no application data, database, migration, or source implementation was added outside this task.

## Completion criteria

- A fresh checkout can install with the pinned package manager and compile strict native-ESM TypeScript.
- The CLI entrypoint and test harness are runnable but contain no unapproved MVP behavior.
- Required scripts and runtime pins are documented and tested.
- The lockfile and intentional project configuration are ready for subsequent tasks.
- Task documentation records verification results and any dependency/version decisions.

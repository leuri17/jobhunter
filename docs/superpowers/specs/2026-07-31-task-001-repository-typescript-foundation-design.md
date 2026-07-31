# TASK-001 — Repository and TypeScript Foundation Design

**Date:** 2026-07-31  
**Status:** Design approved in conversation; implementation not approved  
**Task:** TASK-001 — Repository and TypeScript Foundation

## 1. Goal

Establish the smallest runnable JobHunter repository without implementing MVP product behavior. The result is a pinned Node/pnpm project with strict native-ESM TypeScript compilation, a help-only Commander entrypoint, a separated Vitest harness, and explicitly configured ESLint and Prettier tooling.

This design is limited to the scope of `docs/tasks/TASK-001-repository-typescript-foundation.md` and the referenced sections of `SPEC.md`.

## 2. Scope and boundaries

### In scope

- Pin Node.js `24.18.0` in `.node-version`.
- Declare the required Node engine range and pnpm version in `package.json`.
- Configure native ESM with `"type": "module"` and TypeScript `NodeNext` module/module-resolution settings.
- Configure strict source compilation from `src/` to `dist/`, including declarations and source maps.
- Add a thin Commander entrypoint that renders program metadata/help but registers no product commands.
- Establish normal and explicitly opted-in live Vitest configurations.
- Add ESLint using the official initializer’s clean TypeScript/ESM defaults, with `typescript-eslint` and `eslint-config-prettier`.
- Add Prettier with exactly the requested project options.
- Add scripts for development execution, production build/execution, typechecking, linting, formatting, normal tests, coverage, and live-test execution/discovery.
- Replace the current broad `docs/` ignore rule with repository-safe ignores that preserve shared task/spec documentation while excluding generated and local runtime artifacts.
- Add a minimal meaningful foundation test and the corresponding verification documentation.

### Out of scope

- Operational configuration and OS-specific paths.
- Logging, typed application errors, prompts, persistence, SQLite, Drizzle, migrations, scraping, OpenAI, filtering, scoring, ranking, and product commands.
- Any future-task runtime dependency or implementation.
- Worktrees, branches, staging, commits, or pull requests unless separately approved by the user.

## 3. Dependency boundary

The foundation will install only dependencies needed to run the repository, CLI bootstrap, and development checks:

### Runtime

- `commander`

### Development

- `typescript`
- `tsx`
- `@types/node`
- `vitest`
- `@vitest/coverage-v8`
- `eslint`
- `@eslint/js`
- `globals`
- `typescript-eslint`
- `eslint-config-prettier`
- `prettier`

The exact compatible versions will be selected during the approved implementation and committed in `package.json` and `pnpm-lock.yaml`. No Drizzle, SQLite, Zod, Pino, Playwright, OpenAI, or Inquirer dependency will be installed by this task.

## 4. Repository structure

The expected TASK-001 files are:

```text
.node-version
package.json
pnpm-lock.yaml
tsconfig.json
tsconfig.test.json
eslint.config.mjs
.prettierrc.json
.prettierignore
vitest.config.ts
vitest.live.config.ts
src/cli.ts
tests/foundation.test.ts
```

The existing `.gitignore` currently ignores the entire `docs/` directory. TASK-001 will remove that broad rule so `SPEC.md`, task documents, and planning documents can be tracked, then add the repository-safe patterns required by `GIT.md`, including `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, environment secrets, logs, local runtime data, diagnostics, caches, Playwright output, editor state, GitNexus state, worktrees, and agent state.

## 5. Build and module design

`package.json` will use native ESM and expose compiled execution through `dist/cli.js`. TypeScript will use the required strict options, including:

- `target: "ES2023"`
- `module: "NodeNext"`
- `moduleResolution: "NodeNext"`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `useUnknownInCatchVariables: true`
- `resolveJsonModule: true`
- `sourceMap: true`
- `declaration: true`
- `rootDir: "src"`
- `outDir: "dist"`

`tsconfig.json` will be the production/source project. A separate `tsconfig.test.json` will typecheck source, tests, and TypeScript test configuration without emitting output, avoiding test files being emitted into `dist/` while still checking them.

`src/cli.ts` will export a small program factory so the harness can test it without invoking Commander parsing. Direct execution will parse the process arguments. The program will expose only name/description/help metadata and must not resolve application paths, create directories, initialize a database, or register future product commands.

## 6. ESLint and Prettier design

### ESLint

The ESLint configuration will be generated through the official initializer for a TypeScript, native-ESM, framework-free repository. The generated configuration and its required dependencies will be retained rather than replaced by a hand-inferred rule set.

`typescript-eslint` will provide TypeScript support. `eslint-config-prettier` will be integrated to disable formatting rules that conflict with Prettier. No additional project-specific rules, framework plugins, import-order policy, naming policy, or stylistic policy will be introduced in TASK-001.

Scripts:

- `lint`: check the repository with ESLint.
- `lint:fix`: run ESLint’s explicit fix mode.

### Prettier

`.prettierrc.json` will contain exactly these non-default project decisions and no other inferred options:

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all",
  "endOfLine": "lf",
  "arrowParens": "always"
}
```

`.prettierignore` will exclude generated output and local-only artifacts such as `node_modules/`, `dist/`, `coverage/`, runtime data, diagnostics, logs, caches, Playwright output, and agent state.

Scripts:

- `format`: format supported repository files in write mode.
- `format:check`: verify formatting without modifying files.

## 7. Test harness design

`vitest.config.ts` will run the normal test suite and explicitly exclude `tests/live/**`. `vitest.live.config.ts` will include only `tests/live/**` and tolerate an empty live suite until a later task owns a live scraper test. The normal command must never discover live tests.

`tests/foundation.test.ts` will exercise the exported Commander program factory. It will verify that help metadata is available, that no product command is registered, and that constructing/rendering help has no filesystem side effects. This is a real foundation contract test rather than a placeholder test.

The coverage script will use the explicit V8 provider dependency. Live tests will remain opt-in and will not run under the normal `test` or `test:coverage` scripts.

## 8. Scripts

The final script names and behavior will be:

- `dev` — execute `src/cli.ts` with `tsx`.
- `build` — compile the production TypeScript project to `dist/`.
- `start` — execute the compiled `dist/cli.js` with Node.
- `typecheck` — run source and test TypeScript checks without emitting output.
- `lint` — run ESLint in check mode.
- `lint:fix` — run ESLint with fixes enabled.
- `format` — run Prettier in write mode.
- `format:check` — run Prettier in check mode.
- `test` — run normal Vitest tests.
- `test:coverage` — run normal tests with V8 coverage.
- `test:live` — explicitly run the live-test configuration with empty-suite tolerance.
- `test:live:list` — list only live-test candidates for discovery/verification.

## 9. Verification plan

The implementation will verify, in order:

1. `node --version` returns `v24.18.0`.
2. `pnpm --version` returns `11.18.0`.
3. `pnpm install --frozen-lockfile` succeeds.
4. `pnpm format:check` succeeds.
5. `pnpm lint` succeeds.
6. `pnpm typecheck` succeeds.
7. `pnpm build` succeeds.
8. The build contains `dist/cli.js`, declaration files, and source maps.
9. `pnpm test` succeeds and normal discovery excludes `tests/live/**`.
10. `pnpm test:live:list` and `pnpm test:live` use only the explicit live configuration.
11. `node dist/cli.js --help` succeeds inside a clean temporary home/XDG environment.
12. The help smoke check leaves no application data, configuration, state, cache, diagnostics, log, database, migration, or other runtime artifacts.
13. Final status/diff inspection shows only TASK-001 foundation files changed.

## 10. Risks and controls

- **Generated ESLint configuration varies by initializer version:** use the selected initializer output and frozen lockfile; do not add unrelated rules.
- **ESM source/compiled invocation differs:** verify both `pnpm dev -- --help` and `pnpm build && pnpm start -- --help` paths.
- **Coverage fails because its provider is implicit:** install `@vitest/coverage-v8` directly and use it explicitly.
- **Live tests leak into normal checks:** use separate Vitest config files and verify discovery explicitly.
- **Prettier changes files during verification:** use `format:check` in the verification sequence; keep `format` and `lint:fix` as explicit mutation commands.
- **Foundation expands into product work:** enforce the scope checklist during final review and reject product commands, paths, schemas, migrations, or services.

## 11. Completion boundary

TASK-001 is complete when a fresh checkout can install with the pinned package manager, pass the configured formatting/lint/type/test checks, compile strict native-ESM TypeScript with declarations and source maps, and render CLI help without creating runtime state. The task must stop there and hand the conventions to TASK-002 and later tasks.

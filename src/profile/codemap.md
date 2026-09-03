# src/profile/

## Responsibility

The profile subsystem owns the end-to-end CV/resume lifecycle: ingest raw
document sources (PDF, markdown, plain text), normalize and version them,
extract a canonical `ProfessionalProfile` via OpenAI, surface conflicts and
warnings, and gate lifecycle transitions (review → edit → approve → reject)
so that exactly one row in `profile_versions` is `active + approved` at any
time.

## Design

Service-oriented layering over a pure-domain core. Each service depends only
on the `Repositories` facade and a narrow prompt seam, so every step is
independently testable and free of Playwright / Drizzle / the `openai` SDK /
Pino.

- **Source ingestion** — `ProfileImportService.importSources` validates the
  source type via `detectSourceTypeFromPath` / `mimeTypeFor`, SHA-256
  deduplicates against `profile_sources`, atomically copies the file
  (`.tmp` + rename) via `copySourceFileToStorage`, runs the matching
  `Extractor` from `extractors/` (`PdfExtractor`, `MarkdownExtractor`,
  `PlainTextExtractor`), and persists `extractedTextHash` so re-extractions
  stay stable.
- **Extraction** — `ProfileExtractionService.extract` computes a
  content-addressable extraction fingerprint (source SHA-256s + schema +
  prompt + model + structured-output + extractor versions) for draft reuse,
  re-reads stored bytes through the same extractor + normalizer, builds
  the prompt via `openai/prompt.ts`, calls `OpenAIClient.extract` under
  `runWithRetry`, Zod-parses against
  `createExtractedProfileSchema(knownSourceIds)`, then funnels through the
  pure `postProcessExtractionResponse` (rehash via
  `calculateProfileContentHash`, date coercion, dedupe by
  `normalizedName`, derived fields).
- **Read services** — `ProfileReviewService.list` / `show` resolve a profile
  identifier via `resolveProfileVersionId` and return a full
  `ProfileShowPayload` (profile + warnings + conflicts + overrides +
  revisions).
- **Edit lifecycle** — `ProfileEditingService.startEdit` opens a draft
  in place, or derives a fresh `draft` from an `approved` row with a
  `derived_from_approved_<id>` revision; the interactive loop drives a
  pure `reduce` state machine against `ProfileEditorPrompts` (scripted /
  failing adapters in tests, sidecar adapter in production). On save:
  fresh `contentHash`, `profile_revisions`, upserted `derived_overrides`.
- **Approval** — `ProfileApprovalService.approve` re-validates Zod, refuses
  while `BlockingConflictsUnresolvedError` blocks, recalculates the
  canonical hash, calls `profileVersions.approve` (atomic swap: prior
  active → `superseded`, new row → `approved` + `active`), and invalidates
  dependent `filter_results`.
- **Rejection** — `ProfileRejectionService.reject` marks a draft `rejected`
  and leaves the previously approved profile active; no invalidations.
- **Cross-cutting** — `BinaryFileSystem` abstraction, `hashing`
  (SHA-256), `content-hash.calculateProfileContentHash` (sorted-key stable
  JSON), `name-normalize` (NFKD + `ALIAS_MAP`), `dates` (YearMonth math),
  `conflicts.detectProfileConflicts` (multi-source deep-equal on grouped
  entities), and the `ProfileLifecycleError` family mapped to `ExitCode`.

Pure helpers live in `review/` (`renderReviewSummary`,
`resolveConflictOnProfile`, `applyOverrides`) and `editing/`
(`reduce` / `emptyDraftState` / `validateScalar` / `ProfileEditorPrompts`).

## Flow

1. **Import** — `ProfileImportService.importSources(rawPaths)` →
   `importOne` per path: `detectSourceTypeFromPath` → `findBySha256` or
   insert `profile_sources` → `copySourceFileToStorage` →
   `resolveExtractor(sourceType).extract(bytes)` → `normalizeExtractedText`
   → SHA-256 → `updateExtraction`.
2. **Extract** — `ProfileExtractionService.extract(sourceIds)` → load rows
   → `calculateExtractionFingerprint` →
   `profileVersions.findByExtractionFingerprint` (reuse existing draft or
   proceed) → `loadSourceText` per row → `buildProfileExtractionPrompt` →
   `openaiClient.extract` inside `runWithRetry` → `postProcessExtractionResponse`
   → transactional insert of `profile_versions` (`draft`),
   `profile_conflicts`, `profile_warnings`, plus an `openai_metadata`
   audit row.
3. **Review** — `ProfileReviewService.show(rawId)` → `resolveProfileVersionId`
   → `ProfessionalProfileSchema.safeParse` → parallel fetch of warnings,
   conflicts, overrides, revisions → `ProfileShowPayload`.
4. **Edit** — `ProfileEditingService.startEdit(rawId)` → resolve id → if
   `approved`, `deriveDraftFromApproved` (new draft row +
   `profile_revisions` source=`user`, note=`derived_from_approved_<id>`) →
   `runSession` loop (`prompts.selectSection` → `dispatchSection` →
   `reduce`) → on `save`: transactional `profileJson` update with
   `calculateProfileContentHash` + per-revision inserts + override
   upserts.
5. **Approve** — `ProfileApprovalService.approve(rawId)` → resolve id →
   re-validate Zod → refuse on unresolved blocking → user confirmation on
   non-blocking warnings → rehash + `profileVersions.approve` (atomic swap)
   → `filterResults.invalidateByProfileVersion` on superseded row.
6. **Reject** — `ProfileRejectionService.reject(rawId)` → resolve id →
   user confirmation → `profileVersions.reject`.

## Integration

- **Consumers** —
  - `src/init/init-service.ts`: wires `ProfileImportService`,
    `ProfileExtractionService`, `ProfileApprovalService`,
    `ProfileRejectionService` for the first-run init flow.
  - `src/init/openai-resolve.ts`: instantiates `createDefaultOpenAIClient`.
  - `src/reevaluation/fingerprint.ts`: imports `hashString` and
    `ProfessionalProfile` for candidate versioning.
  - `src/scoring/service.ts`, `src/scoring/fingerprint.ts`: reuse
    `hashString`, `runWithRetry`, `OpenAIClient`, response-schema registry.
  - `src/pipeline/orchestrator.ts`: drives the lifecycle across init,
    filtering, scoring, and reevaluation.
  - `src/filter/`: imports `SeniorityLevelSchema`, `SENIORITY_LEVELS`,
    `normalizeLanguageName`, `ProfessionalProfile` for rule matching.
- **Collaborators** —
  - `src/profile/openai/`: `OpenAIClient`, `runWithRetry`,
    `buildProfileExtractionPrompt`, `calculateExtractionFingerprint`,
    `STRUCTURED_OUTPUT_SCHEMA_VERSION`, `createExtractedProfileSchema`,
    `FakeOpenAIClient`, typed error family.
  - `src/profile/extractors/`: `resolveExtractor` → `PdfExtractor`,
    `MarkdownExtractor`, `PlainTextExtractor`.
  - `src/profile/review/`: `renderReviewSummary`,
    `resolveConflictOnProfile`, `applyOverrides`.
  - `src/profile/editing/`: `reduce`, `emptyDraftState`, validators,
    `ProfileEditorPrompts`.
  - `src/persistence/repositories/profile-versions.ts`: `findById`,
    `findByExtractionFingerprint`, `approve`, `reject`, `listConflicts`,
    `listWarnings`, `listOverrides`, `listRevisions`, `findActiveApproved`,
    `upsertOverride`.
  - `src/persistence/repositories/filter-results.ts`:
    `invalidateByProfileVersion` (post-approval).
  - `src/persistence/repositories/profile-sources.ts`: `findBySha256`,
    `insert`, `updateStoredPath`, `updateExtraction`, `findById`.
  - `src/persistence/schema.ts`: `profileVersions`, `profileConflicts`,
    `profileWarnings`, `profileRevisions` Drizzle tables.
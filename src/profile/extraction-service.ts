/**
 * Application-level orchestrator for the OpenAI profile-extraction pipeline
 * (SPEC.md §14.5, §15.1, §25.3, §25.4, §40).
 *
 * The service glues together:
 *   - source loading (`repositories.profileSources.findById`)
 *   - stored-text recovery (file system + extractor + normalizer)
 *   - extraction fingerprint calculation
 *   - draft reuse detection (`repositories.profileVersions.findByExtractionFingerprint`)
 *   - OpenAI structured-output extraction via `runWithRetry`
 *   - Zod validation against the known `sourceId` set
 *   - the pure `postProcessExtractionResponse` (Task 6)
 *   - transactional persistence of the draft profile version, conflicts, and warnings
 *   - persistence of an `openai_request_metadata` audit row
 *
 * The active approved profile is NEVER mutated here — approval is the job of
 * Task 9.
 *
 * This module is application code: it imports the repository facade, the
 * OpenAI client interface (never the SDK), the Zod schemas, and the
 * post-processor. It does NOT import Playwright, the
 * `openai` SDK, or Pino.
 */

import {
  OpenAIInvalidOutputError,
  ProfileExtractionError,
  ProfileExtractionInputTooLargeError,
  ProfileExtractionSourceUnusableError,
} from './openai/errors.js';
import {
  EXTRACTOR_IMPLEMENTATION_VERSION,
  PROFILE_EXTRACTION_PROMPT_VERSION,
  calculateExtractionFingerprint,
} from './openai/fingerprint.js';
import { runWithRetry, type RetryOptions } from './openai/retry.js';
import { buildProfileExtractionPrompt } from './openai/prompt.js';
import {
  STRUCTURED_OUTPUT_SCHEMA_VERSION,
  createExtractedProfileSchema,
  type ExtractedProfile,
} from './openai/structured-output.js';
import type {
  OpenAIClient,
  OpenAIExtractionRequest,
  OpenAIExtractionSource,
} from './openai/types.js';
import { resolveExtractor } from './extractors/index.js';
import { createDefaultBinaryFileSystem, type BinaryFileSystem } from './file-system.js';
import { postProcessExtractionResponse } from './post-process.js';
import { Repositories } from '../persistence/repositories/index.js';
import type { ProfileSourceRow } from '../persistence/repositories/profile-sources.js';
import { profileConflicts, profileVersions, profileWarnings } from '../persistence/schema.js';
import { PROFILE_SCHEMA_VERSION } from './schema.js';
import { normalizeExtractedText } from './text-normalize.js';

// ---------- Public types ----------

export interface ProfileExtractionLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export const noopProfileExtractionLogger: ProfileExtractionLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * One source as the orchestrator sees it internally: a row from
 * `profile_sources` joined with the normalized text recovered from its
 * stored file. Exported because later callers (Task 8 CLI diagnostics) may
 * want to surface the same shape.
 */
export interface ProfileExtractionSourceInput {
  readonly internalId: number;
  readonly sourceId: string;
  readonly extractedText: string;
  readonly originalFilename: string;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
}

export interface ProfileExtractionConfig {
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
}

export type ProfileExtractionStatus =
  | {
      readonly kind: 'reused';
      readonly profileVersionId: number;
      readonly contentHash: string;
    }
  | {
      readonly kind: 'created';
      readonly profileVersionId: number;
      readonly contentHash: string;
      readonly conflicts: number;
      readonly warnings: readonly string[];
    }
  | {
      readonly kind: 'failed';
      readonly errorCode: string;
      readonly message: string;
      /**
       * Number of OpenAI attempts the orchestrator made before giving up.
       * For pre-call failures (no usable sources, missing source row,
       * `ProfileExtractionInputTooLargeError`) the value is `0`.
       */
      readonly attemptCount: number;
    };

export interface ProfileExtractionServiceOptions {
  readonly repositories: Repositories;
  readonly openaiClient: OpenAIClient;
  readonly config: ProfileExtractionConfig;
  readonly retry?: Partial<RetryOptions>;
  readonly now?: () => Date;
  readonly logger?: ProfileExtractionLogger;
  /**
   * Maximum total UTF-8 byte length of all source `extractedText` values
   * the orchestrator is allowed to assemble into one request. When the
   * computed total exceeds this bound the orchestrator raises
   * `ProfileExtractionInputTooLargeError` and never contacts OpenAI.
   * Default: {@link DEFAULT_INPUT_BYTE_LIMIT} (~1 MB / ~250k tokens).
   */
  readonly inputByteLimit?: number;
}

// ---------- Internals ----------

/** OpenAI structured-output schema name. Must match an entry in
 *  `RESPONSE_SCHEMA_REGISTRY` (see `src/profile/openai/response-schemas.ts`).
 *  The client looks the name up at request time to find the matching
 *  JSON Schema + version. */
const RESPONSE_SCHEMA_NAME = 'ExtractedProfile';

/**
 * Default upper bound on the total UTF-8 size of all source `extractedText`
 * values that one extraction request is allowed to carry. We fail loud
 * (`ProfileExtractionInputTooLargeError`) above this rather than silently
 * truncate the input, in line with 's posture applied to the
 * extraction surface.
 *
 * 1,000,000 bytes ≈ 250k tokens for English-heavy UTF-8 inputs. Tunable
 * per call site via `ProfileExtractionServiceOptions.inputByteLimit`.
 */
const DEFAULT_INPUT_BYTE_LIMIT = 1_000_000;

const utf8Encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).length;
}

function totalRequestBytes(sources: readonly OpenAIExtractionSource[]): number {
  let total = 0;
  for (const source of sources) {
    total += utf8ByteLength(source.extractedText);
  }
  return total;
}

// ---------- Service ----------

export class ProfileExtractionService {
  private readonly repositories: Repositories;
  private readonly openaiClient: OpenAIClient;
  private readonly config: ProfileExtractionConfig;
  private readonly retry: Partial<RetryOptions>;
  private readonly now: () => Date;
  private readonly logger: ProfileExtractionLogger;
  private readonly fileSystem: BinaryFileSystem;
  private readonly inputByteLimit: number;

  constructor(options: ProfileExtractionServiceOptions) {
    this.repositories = options.repositories;
    this.openaiClient = options.openaiClient;
    this.config = options.config;
    this.retry = options.retry ?? {};
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger ?? noopProfileExtractionLogger;
    this.fileSystem = createDefaultBinaryFileSystem();
    this.inputByteLimit = options.inputByteLimit ?? DEFAULT_INPUT_BYTE_LIMIT;
  }

  /**
   * Run the full extraction pipeline for the given source IDs. Returns a
   * discriminated-union `ProfileExtractionStatus` — never throws for
   * expected failures (every typed error is translated into a
   * `kind: 'failed'` result so the CLI can render a structured response
   * without an exception path).
   */
  async extract(sourceIds: readonly number[]): Promise<ProfileExtractionStatus> {
    if (sourceIds.length === 0) {
      return {
        kind: 'failed',
        errorCode: 'profile_extraction_source_unusable',
        message: 'Profile extraction requires at least one source.',
        attemptCount: 0,
      };
    }

    const startTimestamp = this.now().toISOString();

    // 1. Load every source row from the database.
    const rows: ProfileSourceRow[] = [];
    for (const internalId of sourceIds) {
      const row = await this.repositories.profileSources.findById(internalId);
      if (row === null) {
        return {
          kind: 'failed',
          errorCode: 'profile_extraction_source_unusable',
          message: `Profile source ${internalId} was not found in the database.`,
          attemptCount: 0,
        };
      }
      if (row.textExtractionStatus !== 'success') {
        return {
          kind: 'failed',
          errorCode: 'profile_extraction_source_unusable',
          message: `Profile source ${internalId} has textExtractionStatus "${row.textExtractionStatus}" — only "success" is usable for extraction.`,
          attemptCount: 0,
        };
      }
      rows.push(row);
    }

    // 2. Compute the extraction fingerprint. Sources are sorted
    //    by sha256 inside `calculateExtractionFingerprint`, so order on the
    //    CLI does not affect the digest.
    const fingerprint = calculateExtractionFingerprint({
      sourceHashes: rows.map((r) => r.sha256),
      schemaVersion: PROFILE_SCHEMA_VERSION,
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
      extractorImplementationVersion: EXTRACTOR_IMPLEMENTATION_VERSION,
    });

    // 3. Reuse a draft row when one already exists for this fingerprint.
    const existing =
      await this.repositories.profileVersions.findByExtractionFingerprint(fingerprint);
    if (existing !== null && existing.status === 'draft') {
      this.logger.info(
        {
          event: 'profile_extraction_reused',
          profileVersionId: existing.id,
          fingerprint,
        },
        `Reusing existing draft profile version ${existing.id} for fingerprint ${fingerprint}.`,
      );
      return {
        kind: 'reused',
        profileVersionId: existing.id,
        contentHash: existing.contentHash,
      };
    }

    // 4. Recover the normalized text from each source's stored file. If any
    //    file is unreadable, fail before contacting OpenAI.
    const sources: ProfileExtractionSourceInput[] = [];
    for (const row of rows) {
      let extractedText: string;
      try {
        extractedText = await this.loadSourceText(row);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        this.logger.error(
          {
            event: 'profile_extraction_source_read_failed',
            sourceId: row.id,
            storedPath: row.storedPath,
          },
          `Failed to read stored text for source ${row.id}: ${reason}`,
        );
        return {
          kind: 'failed',
          errorCode: 'profile_extraction_source_unusable',
          message: `Profile source ${row.id} stored text could not be loaded: ${reason}`,
          attemptCount: 0,
        };
      }
      sources.push({
        internalId: row.id,
        sourceId: `source_${row.id}`,
        extractedText,
        originalFilename: row.originalFilename,
        textExtractionStatus: row.textExtractionStatus,
      });
    }

    // 5. Build the OpenAI extraction request. The `OpenAIClient` is a pure
    //    transport — it does not build messages internally. We call
    //    `buildProfileExtractionPrompt` here to produce the system + user
    //    chat payload, then attach the messages to the request.
    const sourcesForPrompt: OpenAIExtractionSource[] = sources.map((source) => ({
      sourceId: source.sourceId,
      originalFilename: source.originalFilename,
      extractedText: source.extractedText,
    }));
    const { systemMessage, userMessage } = buildProfileExtractionPrompt({
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      sources: sourcesForPrompt,
    });
    const request: OpenAIExtractionRequest = {
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      sources: sourcesForPrompt,
      responseSchemaName: RESPONSE_SCHEMA_NAME,
      structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
    };

    // 6-7. Call OpenAI with the  retry policy. Parse and Zod-validate
    //      the response INSIDE the operation closure so a corrective retry
    //      (single permitted retry on `OpenAIInvalidOutputError`) can rerun
    //      the parse with a fresh response.
    const knownSourceIds = sources.map((s) => s.sourceId);
    type RetryResult = {
      rawResponse: {
        readonly rawJsonText: string;
        readonly tokenUsage: {
          readonly promptTokens: number;
          readonly completionTokens: number;
        } | null;
      };
      extracted: ExtractedProfile;
    };
    let retryResult: {
      value: RetryResult;
      attempts: readonly { readonly attemptNumber: number; readonly succeeded: boolean }[];
    };
    try {
      // 6. Reject oversized inputs BEFORE any OpenAI call.
      //    We fail loud rather than silently truncate.
      const totalRequestByteSize = totalRequestBytes(request.sources);
      if (totalRequestByteSize > this.inputByteLimit) {
        throw new ProfileExtractionInputTooLargeError({
          totalBytes: totalRequestByteSize,
          limit: this.inputByteLimit,
        });
      }

      // 7. Call OpenAI with the  retry policy. Parse and Zod-validate
      //    the response INSIDE the operation closure so a corrective retry
      //    (single permitted retry on `OpenAIInvalidOutputError`) can rerun
      //    the parse with a fresh response.
      retryResult = await runWithRetry<RetryResult>(async () => {
        const rawResponse = await this.openaiClient.extract(request);
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawResponse.rawJsonText);
        } catch (cause) {
          throw new OpenAIInvalidOutputError({}, cause instanceof Error ? cause : undefined);
        }
        const parsedResult = createExtractedProfileSchema(knownSourceIds).safeParse(parsed);
        if (!parsedResult.success) {
          throw new OpenAIInvalidOutputError({}, parsedResult.error);
        }
        return { rawResponse, extracted: parsedResult.data };
      }, this.retry);
    } catch (caught) {
      const errorCode =
        caught instanceof ProfileExtractionError ? caught.code : 'openai_invalid_output';
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      // `ProfileExtractionInputTooLargeError` is raised before any OpenAI
      // attempt, so the audit row records `attemptCount: 0`. For every
      // other failure the retry policy attaches `attempts` to the error;
      // we read its length, defaulting to 1 for unexpected non-`ApplicationError`
      // throws.
      const attemptCount =
        caught instanceof ProfileExtractionInputTooLargeError
          ? 0
          : caught instanceof ProfileExtractionError
            ? (caught.attempts?.length ?? 1)
            : 1;
      const endTimestamp = this.now().toISOString();
      this.logger.error(
        {
          event: 'profile_extraction_openai_failed',
          errorCode,
          attemptCount,
        },
        `OpenAI extraction failed after ${attemptCount} attempt(s): ${errorMessage}`,
      );
      await this.repositories.openaiMetadata.insert({
        operationType: 'profile_extraction',
        relatedEntityType: null,
        relatedEntityId: null,
        inputHashes: rows.map((r) => r.sha256),
        promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
        structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
        model: this.config.model,
        reasoningEffort: this.config.reasoningEffort,
        configJson: {
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
          structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
          schemaVersion: PROFILE_SCHEMA_VERSION,
        },
        tokenUsage: null,
        validatedOutput: null,
        attemptCount,
        startTimestamp,
        endTimestamp,
        success: false,
        errorCode,
        errorMessage,
      });
      return {
        kind: 'failed',
        errorCode,
        message: errorMessage,
        attemptCount,
      };
    }

    const {
      value: { rawResponse, extracted },
      attempts,
    } = retryResult;

    // 8. Post-process into the canonical profile (Task 6).
    const processed = postProcessExtractionResponse({
      extracted,
      knownSourceIds,
      now: this.now,
    });

    // 9. Persist the draft profile version, conflicts, and warnings in a
    //    single transaction so partial writes cannot leak.
    const profileVersionId = this.persistDraft(fingerprint, rows, processed);

    // 10. Persist the audit metadata row (success).
    const endTimestamp = this.now().toISOString();
    await this.repositories.openaiMetadata.insert({
      operationType: 'profile_extraction',
      relatedEntityType: 'profile_version',
      relatedEntityId: profileVersionId,
      inputHashes: rows.map((r) => r.sha256),
      promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
      structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      configJson: {
        model: this.config.model,
        reasoningEffort: this.config.reasoningEffort,
        promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
        structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
        schemaVersion: PROFILE_SCHEMA_VERSION,
      },
      tokenUsage: rawResponse.tokenUsage,
      validatedOutput: extracted,
      attemptCount: attempts.length,
      startTimestamp,
      endTimestamp,
      success: true,
      errorCode: null,
      errorMessage: null,
    });

    this.logger.info(
      {
        event: 'profile_extraction_created',
        profileVersionId,
        fingerprint,
        attemptCount: attempts.length,
        conflicts: processed.conflicts.length,
        warnings: processed.warnings.length,
      },
      `Created draft profile version ${profileVersionId} from ${sources.length} source(s).`,
    );

    return {
      kind: 'created',
      profileVersionId,
      contentHash: processed.profile.contentHash,
      conflicts: processed.conflicts.length,
      warnings: processed.warnings,
    };
  }

  // ---------- Helpers ----------

  /**
   * Re-read the stored source file, run the matching extractor, and
   * normalize the text. The result should match the text that was hashed
   * into `extractedTextHash` at import time (the import pipeline runs the
   * same flow before hashing), so the fingerprint stays stable.
   */
  private async loadSourceText(row: ProfileSourceRow): Promise<string> {
    const bytes = await this.fileSystem.readBytes(row.storedPath);
    const extractor = resolveExtractor(row.sourceType);
    const extraction = await extractor.extract(bytes);
    if (extraction.status !== 'success') {
      throw new ProfileExtractionSourceUnusableError({
        sourceId: row.id,
        reason: extraction.message,
      });
    }
    return normalizeExtractedText(extraction.text);
  }

  /**
   * Insert the draft `profile_versions` row, every conflict, and every
   * warning in one transaction. Uses the `txRepos.db` handle for direct
   * synchronous Drizzle writes — the sub-repository wrappers are
   * `async`-shaped but resolve synchronously against `better-sqlite3`,
   * and we want to guarantee the operations complete before COMMIT.
   */
  private persistDraft(
    fingerprint: string,
    rows: readonly ProfileSourceRow[],
    processed: ReturnType<typeof postProcessExtractionResponse>,
  ): number {
    return this.repositories.transact((txRepos) => {
      const inserted = txRepos.db
        .insert(profileVersions)
        .values({
          status: 'draft',
          schemaVersion: PROFILE_SCHEMA_VERSION,
          contentHash: processed.profile.contentHash,
          extractionFingerprint: fingerprint,
          sourceIdsJson: JSON.stringify(rows.map((r) => r.id)),
          profileJson: JSON.stringify(processed.profile),
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
          structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
          extractorImplementationVersion: EXTRACTOR_IMPLEMENTATION_VERSION,
          validationWarningsJson: JSON.stringify(processed.warnings),
          unresolvedConflictsJson: JSON.stringify(processed.conflicts),
          createdAt: this.now().toISOString(),
          updatedAt: this.now().toISOString(),
          approvedAt: null,
          supersededAt: null,
          active: false,
        })
        .returning({ id: profileVersions.id })
        .all();
      const row = inserted[0];
      if (row === undefined) {
        throw new Error(
          'ProfileExtractionService.persistDraft: profile_versions insert returned no rows.',
        );
      }
      const profileVersionId = row.id;

      for (const conflict of processed.conflicts) {
        txRepos.db
          .insert(profileConflicts)
          .values({
            profileVersionId,
            conflictType: conflict.conflictType,
            affectedField: conflict.affectedField,
            valueSourceAJson: JSON.stringify(conflict.valueSourceA ?? null),
            valueSourceBJson: JSON.stringify(conflict.valueSourceB ?? null),
            sourceReferencesJson: JSON.stringify(conflict.sourceReferences),
            provisionalValueJson: JSON.stringify(conflict.provisionalValue ?? null),
            explanation: conflict.explanation,
            resolutionStatus: 'unresolved',
            resolvedAt: null,
            resolvedValueJson: null,
          })
          .run();
      }

      const warningTimestamp = this.now().toISOString();
      for (const warning of processed.warnings) {
        txRepos.db
          .insert(profileWarnings)
          .values({
            profileVersionId,
            severity: 'warning',
            warningType: 'extraction_warning',
            fieldPath: null,
            message: warning,
            createdAt: warningTimestamp,
          })
          .run();
      }

      return profileVersionId;
    });
  }
}

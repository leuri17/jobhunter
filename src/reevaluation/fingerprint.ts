/**
 * Read-only fingerprint helpers for the reevaluation service (TASK-017
 * Wave C, SPEC §27.4 + §28).
 *
 * Both helpers in this module are PURE functions of the inputs. They
 * NEVER touch the database — they only reproduce the canonical fingerprint
 * formula from `src/filter/fingerprint.ts` and `src/scoring/fingerprint.ts`
 * so the reevaluation service can compute the "current fingerprint" for
 * cache-hit/staleness checks WITHOUT calling
 * `FilterApplyService.apply()` (which writes a new row) or
 * `ScoringService.scoreOne()` (which can call OpenAI).
 *
 * The fingerprint values these helpers return must match byte-for-byte
 * the values produced by `FilterApplyService.apply()` /
 * `ScoringService.scoreOne()` for the same inputs — otherwise the
 * reevaluation cache check is wrong and jobs are mis-classified as
 * stale or current. The helpers therefore mirror the input shape +
 * composition order of the original modules exactly.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only
 * `node:crypto`, `src/filter/{fingerprint,schema,version,content-hash}.js`,
 * `src/scoring/{fingerprint,prompt,rubric}.js`, and `src/profile/hashing.js`
 * — all read-only helpers + small types. It does NOT import
 * `src/persistence/`, `src/cli/`, `src/linkedin/`, or `src/init/`.
 */

import { calculateFilterFingerprint } from '../filter/fingerprint.js';
import type { JobFilterConfig } from '../filter/schema.js';
import { FILTER_IMPLEMENTATION_VERSION } from '../filter/version.js';
import { calculateJobContentHash, type JobContentHashInput } from '../filter/content-hash.js';
import { computeScoreFingerprint, SCORER_IMPLEMENTATION_VERSION } from '../scoring/fingerprint.js';
import { SCORING_PROMPT_VERSION } from '../scoring/prompt.js';
import { RUBRIC_VERSION } from '../scoring/rubric.js';
import { hashString } from '../profile/hashing.js';
import type { ProfessionalProfile } from '../profile/schema.js';
import type { JobRow } from '../persistence/repositories/jobs.js';

/**
 * Compute the filter fingerprint for a single complete job, given the
 * active filter configuration + profile JSON (mirrors
 * `calculateFilterFingerprint`'s input shape — SPEC §24.3).
 *
 * The helper intentionally accepts the raw `unknown` row shape for the
 * config + profile so it does not depend on the persistence-layer
 * validation step. The `JobFilterConfig` + `ProfessionalProfile` types
 * are the documented shapes; the reevaluation service reads them from
 * `filterConfigurations.findActive()` / `profileVersions.findActiveApproved()`
 * and casts here.
 */
export function computeFilterFingerprintForJob(
  job: JobRow,
  configJson: unknown,
  profileJson: unknown,
): string {
  const jobInput: JobContentHashInput = {
    title: job.title,
    company: job.company,
    location: job.location,
    description: job.description,
  };
  return calculateFilterFingerprint({
    job: jobInput,
    config: configJson as JobFilterConfig,
    profile: (profileJson ?? null) as ProfessionalProfile | null,
  });
}

/**
 * Compute the score fingerprint for a single complete job, given the
 * active approved profile + the effective derived values + the active
 * filter configuration (mirrors `computeScoreFingerprint`'s input
 * shape — SPEC §27.3).
 *
 * The service computes the `jobContentHash` from the row's title /
 * company / location / description exactly the way
 * `ScoringService.scoreOne` does (Decision: avoid relying on the
 * LinkedIn extraction normalised columns because the service does not
 * load them — the reevaluation is performed on the canonical job
 * record).
 *
 * `effectiveDerivedValues` is read-only data the caller passes
 * through. The MVP pipeline sets it to `{}` (the scoring prompt
 * consults the profile, not the derived values, in the current MVP);
 * Wave C mirrors that.
 *
 * `modelConfig` is left at `{}` because the production
 * `ScoringService` also uses `{}` here (no model-specific overrides
 * in the MVP). Future tasks can plumb a real config through without
 * changing this helper's signature.
 */
export function computeScoreFingerprintForJob(
  job: JobRow,
  profileVersionId: number,
  profileFingerprint: string,
  effectiveDerivedValues: Readonly<Record<string, unknown>>,
  model: string,
  reasoningEffort: string,
): string {
  const jobContentHash = hashString(
    JSON.stringify({
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
    }),
  );
  const effectiveDerivedValuesHash = hashString(JSON.stringify(effectiveDerivedValues));
  return computeScoreFingerprint({
    jobContentHash,
    profileVersionId,
    profileFingerprint,
    effectiveDerivedValuesHash,
    promptVersion: SCORING_PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    model,
    reasoningEffort,
    modelConfig: {},
    scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
  });
}

/**
 * Re-export of `calculateJobContentHash` for callers that want the
 * per-job content hash without the rest of the filter fingerprint
 * surface. The reevaluation service does not use it directly but it
 * is exported for symmetry with the scoring side (`jobContentHash` is
 * always available via `computeScoreFingerprintForJob`).
 */
export { calculateJobContentHash };

/**
 * Re-export of `FILTER_IMPLEMENTATION_VERSION` so the reevaluation
 * service can include it in audit log fields without taking a direct
 * dependency on `src/filter/version.js`.
 */
export { FILTER_IMPLEMENTATION_VERSION };

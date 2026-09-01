/**
 * Profile version identifier resolution.
 *
 * Accepts either of the two documented CLI forms:
 *
 * 1. `profile_<int>`            — the integer primary key with the standard
 *                                  `profile_` prefix ( example:
 *                                  `profile_3`).
 * 2. `profile_<profileId>`      — the human-friendly id stored inside the
 *                                  persisted `ProfessionalProfile.id` field.
 *                                  The same row carries both ids; the prefix
 *                                  is identical so the two forms are visually
 *                                  indistinguishable. We try (1) first
 *                                  (canonical, PK-keyed), and fall back to a
 *                                  scan of all drafts when no row matches
 *                                  the integer form.
 *
 * Resolves to the integer primary key of the matching `profile_versions`
 * row, which is the only stable internal identifier the rest of the
 * application uses.
 *
 * The helper does NOT depend on Commander, Inquirer, Playwright, or the
 * `openai` SDK. It only reaches into the persistence repositories.
 */

import type { Repositories } from '../persistence/repositories/index.js';
import { parsePrefixedId } from '../persistence/identifiers.js';
import { InvalidProfileIdentifierError } from './errors.js';

const PROFILE_ID_KEY = 'profile_';

/**
 * Try to resolve a profile CLI identifier to its integer primary key.
 *
 * Order of resolution:
 *  1. `profile_<int>` form — parsed strictly, looked up via
 *     `profileVersions.findById`.
 *  2. `profile_<ProfessionalProfile.id>` form — scanned across every
 *     `profile_versions` row (the MVP has at most a handful, so a scan is
 *     acceptable). The scan guards against JSON-id collisions (rare, but
 *     the schema does not enforce uniqueness on `profileJson.id`).
 *
 * Throws `InvalidProfileIdentifierError` (`ExitCode.InvalidUsage`) on every
 * failure surface:
 *  - `invalid_identifier`     empty / non-string / wrong prefix / non-integer
 *  - `profile_not_found`      valid form, no matching row
 *  - `profile_id_collision`   JSON-id form matches more than one row
 */
export async function resolveProfileVersionId(
  repositories: Repositories,
  raw: string,
): Promise<number> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InvalidProfileIdentifierError(
      'invalid_identifier',
      'Profile identifier must be a non-empty string.',
      { input: raw },
    );
  }

  // Form (1): profile_<int> — preferred path. The prefix parser throws on
  // any non-integer tail; we translate that into the typed lifecycle error.
  if (raw.startsWith(PROFILE_ID_KEY)) {
    let pk: number;
    try {
      pk = parsePrefixedId(raw, 'profile');
    } catch {
      throw new InvalidProfileIdentifierError(
        'invalid_identifier',
        `Profile identifier "${raw}" must end with a positive integer.`,
        { input: raw },
      );
    }
    const row = await repositories.profileVersions.findById(pk);
    if (row === null) {
      throw new InvalidProfileIdentifierError(
        'profile_not_found',
        `No profile version with id ${pk}.`,
        { input: raw, profileVersionId: pk },
      );
    }
    return row.id;
  }

  // Form (2): profile_<profileJson.id> — the input is treated as the
  // human-friendly id stored inside the JSON. Scan all drafts and
  // approved/superseded/rejected versions for a match. The MVP has at
  // most a handful of profile versions, so an in-memory scan is fine.
  const allRows = await repositories.profileVersions.list();
  const matches: number[] = [];
  for (const row of allRows) {
    const profileJson = row.profileJson as { id?: unknown } | null;
    if (
      profileJson !== null &&
      typeof profileJson === 'object' &&
      typeof profileJson.id === 'string' &&
      profileJson.id === raw
    ) {
      matches.push(row.id);
    }
  }
  if (matches.length === 1) {
    const matchedId = matches[0];
    if (matchedId !== undefined) return matchedId;
  }
  if (matches.length > 1) {
    throw new InvalidProfileIdentifierError(
      'profile_id_collision',
      `Profile identifier "${raw}" matches ${matches.length} profile versions; the JSON id column is not unique.`,
      { input: raw, matchedProfileVersionIds: matches },
    );
  }
  throw new InvalidProfileIdentifierError(
    'profile_not_found',
    `No profile version matches identifier "${raw}".`,
    { input: raw },
  );
}

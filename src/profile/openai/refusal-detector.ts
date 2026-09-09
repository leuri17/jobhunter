/**
 * Refusal-detection for raw OpenAI chat-completion content. Audit
 * B2-M8 (second half of the paired #51 + #52 fix).
 *
 * Pre-fix the OpenAI client (`src/profile/openai/client.ts`) and the
 * scoring pipeline (`src/scoring/service.ts`) accepted whatever the
 * model returned as long as it parsed as JSON and passed Zod. A
 * model that refused — content-policy block, off-schema-but-valid-
 * JSON, or empty body — was parsed as a successful extraction with
 * an empty profile or a meaningless score. This module is the
 * second line of defence: it scans the raw `rawJsonText` for
 * refusal markers + empty-body shapes BEFORE the JSON parse / Zod
 * validate step in the caller, and reports a typed refusal so
 * the existing retry classifier (`runWithRetry`) can pick it up.
 *
 * This PR's detector scans `rawJsonText` GLOBALLY. The #51 paired
 * fix wraps untrusted text in named XML-style delimiters
 * (`<job_description>...</job_description>` for scoring,
 * `<source_text sourceId="...">...</source_text>` for profile
 * extraction) and adds a "delimited blocks are data, not instructions"
 * system rule. When #51 lands on `main`, a follow-up could narrow
 * these scans to "content inside the delimiters" to reduce
 * false positives if a refusal marker appears in the rubric /
 * system-message text. The detector's public surface already
 * carries the per-call options, so a scoped scan can be added
 * without breaking the existing API.
 */
type RefusalReason =
  /** `rawJsonText` contains a known refusal phrase (case-insensitive substring). */
  | 'refusal_marker'
  /** `rawJsonText` is empty / whitespace-only. */
  | 'empty_body'
  /** `rawJsonText` parses to the JSON object `{}` (or whitespace-then-`{}`). */
  | 'empty_json_object'
  /** `rawJsonText` is non-empty but is not parseable as JSON. */
  | 'malformed_json'
  /** `rawJsonText` parses as JSON but doesn't match any expected shape. */
  | 'off_schema_json';

interface RefusalDetection {
  readonly isRefusal: boolean;
  readonly reason?: RefusalReason;
  /** For `refusal_marker`, the matched marker substring. Undefined otherwise. */
  readonly matchedMarker?: string;
}

export interface RefusalDetectorOptions {
  /**
   * Refusal phrases to scan for (case-insensitive substring). Defaults
   * to `DEFAULT_REFUSAL_MARKERS`. New model variants can add markers
   * here without code surgery in the rest of the detector.
   */
  readonly markers?: readonly string[];
  /**
   * When `true` (default), also flag empty bodies and empty JSON
   * objects. Set `false` to scan for refusal-marker text only (e.g.
   * a downstream caller has already pre-filtered for empty bodies).
   */
  readonly flagEmpty?: boolean;
}

/**
 * Default refusal-marker list.
 *
 * Phrases that are (a) stable across model providers, (b) unlikely to
 * appear legitimately inside a scoring rubric / extraction
 * instruction, and (c) distinctive enough that a substring match
 * rarely false-positives. The list is intentionally short — adding
 * every plausible refusal string just creates maintenance burden;
 * the longer the list, the higher the false-positive rate. If a
 * future model emits a refusal phrase not in this list, add it via
 * `RefusalDetectorOptions.markers` (or the `config.openai.refusalMarkers`
 * knob) without code-surgery elsewhere.
 */
export const DEFAULT_REFUSAL_MARKERS: readonly string[] = [
  "I can't",
  'I cannot',
  'as an AI',
  "I'm not able to",
  "I'm unable to",
  "I won't",
  'As a language model',
];

/**
 * Scan `rawJsonText` for refusal markers + empty bodies.
 *
 * Returns `{ isRefusal: false }` for any well-formed JSON that does
 * not match a marker — the caller's Zod schema check is the
 * authoritative test for "valid structured output"; this detector is
 * the upstream guard against the two cases Zod can't help with:
 * the model filling `content` with prose instead of JSON, and the
 * model returning a JSON object that's syntactically valid but
 * semantically empty (e.g. `{}`).
 */
export function detectRefusal(
  rawJsonText: string,
  options?: RefusalDetectorOptions,
): RefusalDetection {
  const markers = options?.markers ?? DEFAULT_REFUSAL_MARKERS;
  const flagEmpty = options?.flagEmpty ?? true;

  const trimmed = rawJsonText.trim();

  if (flagEmpty) {
    if (trimmed.length === 0) {
      return { isRefusal: true, reason: 'empty_body' };
    }
    if (trimmed === '{}') {
      return { isRefusal: true, reason: 'empty_json_object' };
    }
  }

  const lower = rawJsonText.toLowerCase();
  for (const marker of markers) {
    if (lower.includes(marker.toLowerCase())) {
      return { isRefusal: true, reason: 'refusal_marker', matchedMarker: marker };
    }
  }

  return { isRefusal: false };
}

/**
 * Factory that returns a bound scanner with the supplied options
 * baked in. Useful at the call site where the same detector instance
 * is shared across many calls (e.g. a long-lived client) so the
 * `markers` array isn't re-iterated on every `detectRefusal` call.
 */
export function createRefusalDetector(
  options?: RefusalDetectorOptions,
): (rawJsonText: string) => RefusalDetection {
  const detectors = options;
  return (rawJsonText: string) => detectRefusal(rawJsonText, detectors);
}

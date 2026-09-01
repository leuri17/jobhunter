/**
 * Deterministic alias map for skill and language normalization (SPEC.md §12.2).
 *
 * The keys are the **normalized** forms (post-trim, lowercase, NFKD + remove
 * combining marks, separators stripped — see `./name-normalize.ts`). The
 * values are the canonical aliases returned as `normalizedName`.
 *
 * Updates to this file are version-controlled. Each entry must be intentional
 * and traceable to a known abbreviation, misspelling, or alternate naming.
 */

export const ALIAS_MAP: Readonly<Record<string, string>> = Object.freeze({
  //  examples — including the open-decision-table entry
  // `nodejs → nodejs` as an intentional self-mapping that documents the
  // canonical form (no alias is required for `nodejs` to round-trip, but
  // listing it here makes the canonical spelling explicit).
  nodejs: 'nodejs',
  reactjs: 'react',
  'type script': 'typescript',
  // Common CV aliases.
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  k8s: 'kubernetes',
  gcp: 'googlecloud',
  'amazon web services': 'aws',
  'google cloud platform': 'googlecloud',
  ms: 'microsoft',
  pg: 'postgresql',
  postgres: 'postgresql',
});

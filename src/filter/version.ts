/**
 * Filter engine implementation version (SPEC §24.2, Decision 5).
 *
 * Bump on any change that alters filter outcomes (alias map, phrase patterns,
 * evaluation order, abstention semantics). Pure data-only changes do NOT
 * require a bump.
 */
export const FILTER_IMPLEMENTATION_VERSION = '1.0.0' as const;
export type FilterImplementationVersion = typeof FILTER_IMPLEMENTATION_VERSION;

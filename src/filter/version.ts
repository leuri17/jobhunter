/**
 * Filter engine implementation version.
 *
 * Bump on any change that alters filter outcomes (alias map, phrase patterns,
 * evaluation order, abstention semantics). Pure data-only changes do NOT
 * require a bump.
 */
export const FILTER_IMPLEMENTATION_VERSION = '1.0.0' as const;
export type FilterImplementationVersion = typeof FILTER_IMPLEMENTATION_VERSION;

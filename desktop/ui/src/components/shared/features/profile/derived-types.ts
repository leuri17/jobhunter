/**
 * Structural type for the `derived.<field>` objects on a profile: a
 * generated value plus an optional user override. Mirrors
 * `DerivedValueSchema` from `@jobhunter/core/profile` for local
 * component ergonomics.
 */
export interface DerivedValue<T> {
  generatedValue: T;
  overrideActive: boolean;
  overrideValue: T | null;
  effectiveValue: T;
  generatedAt: string | null;
  overriddenAt: string | null;
}

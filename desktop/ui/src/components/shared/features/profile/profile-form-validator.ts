import { useForm } from '@tanstack/react-form';
import type { FormValidateOrFn } from '@tanstack/react-form';
import { ProfessionalProfileSchema } from '@jobhunter/core/profile';
import type { ProfessionalProfile } from '@/lib/types';

/**
 * TanStack Form schema validator for the canonical profile.
 *
 * `ProfessionalProfileSchema` gives its identity fields
 * `.nullable().default(null)` so legacy persisted rows keep parsing. That
 * makes the schema's *input* type carry optional keys, which no longer
 * structurally satisfies TanStack's validator slot (zod input/output
 * variance against `ProfessionalProfile`). At runtime the form always
 * holds complete profile objects — server payloads include every key —
 * so the cast below only reconciles the type-level variance.
 */
export const profileFormValidator =
  ProfessionalProfileSchema as unknown as FormValidateOrFn<ProfessionalProfile>;

/**
 * Shared profile form factory: one place wiring the canonical schema
 * validator, so every consumer (page + test harnesses) gets the same
 * inferred form type. `ProfileFormApi` is the exact type section
 * components accept — structural subsets of the form API do not
 * typecheck against TanStack's invariant Field generics.
 */
export function useProfileForm(options: {
  defaultValues: ProfessionalProfile;
  onSubmit: (props: { value: ProfessionalProfile }) => void | Promise<void>;
}) {
  return useForm({
    defaultValues: options.defaultValues,
    validators: { onChange: profileFormValidator },
    onSubmit: options.onSubmit,
  });
}

export type ProfileFormApi = ReturnType<typeof useProfileForm>;

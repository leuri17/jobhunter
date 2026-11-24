import { useSelector } from '@tanstack/react-form';
import type { OperationalConfig } from '@jobhunter/core/config';
import type { AnyFieldApi } from './types';

/**
 * The form's `aiProvider` section as currently selected — saved or not.
 * Settings sections render inside a `form.Field`, so they can follow
 * the provider select through the field's own form (#359) without
 * extra prop plumbing from the page.
 */
export function useSelectedAiProvider(field: AnyFieldApi): OperationalConfig['aiProvider'] {
  return useSelector(field.form.store, (state) => (state.values as OperationalConfig).aiProvider);
}

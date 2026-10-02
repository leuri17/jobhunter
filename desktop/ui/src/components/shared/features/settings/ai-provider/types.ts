import type { AnyFieldApi } from '@/components/shared/features/settings/search-config/types';

export type { AnyFieldApi };

/**
 * Subset of the React Form API used by the AI section components. Declared
 * structurally so this file does not need to import the generic from
 * `@tanstack/react-form` (which would couple the type to a specific call
 * signature) and so the route can pass any compatible form.
 */
export interface AiSectionForm {
  Field: (props: {
    name: string;
    children: (field: AnyFieldApi) => React.ReactNode;
    mode?: 'value' | 'array';
  }) => React.ReactNode | Promise<React.ReactNode>;
}

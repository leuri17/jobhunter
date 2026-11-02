import type { AnyFieldApi } from '@tanstack/react-form';

export type { AnyFieldApi };

/**
 * Structural subset of the React Form API used by profile section
 * components (same pattern as settings' SectionForm): sections accept a
 * form and bind their own leaf-level `<form.Field>` paths.
 */
export interface ProfileForm {
  Field: (props: {
    name: string;
    children: (field: AnyFieldApi) => React.ReactNode;
    mode?: 'value' | 'array';
  }) => React.ReactNode | Promise<React.ReactNode>;
}

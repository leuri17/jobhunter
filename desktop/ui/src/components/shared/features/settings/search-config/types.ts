import type { AnyFieldApi } from '@tanstack/react-form';

export type { AnyFieldApi };

/**
 * Structural subset of the React Form API used by settings section
 * components. Sections accept a form and bind their own leaf-level
 * `<form.Field>` paths, so per-field validation errors render under
 * the right control without the parent needing to plumb each field.
 */
export interface SectionForm {
  Field: (props: {
    name: string;
    children: (field: AnyFieldApi) => React.ReactNode;
    mode?: 'value' | 'array';
  }) => React.ReactNode | Promise<React.ReactNode>;
}

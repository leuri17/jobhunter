import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { z } from 'zod';
import type { AnyFieldApi, SectionForm } from './types';

interface BaseUrlSectionProps {
  form: SectionForm;
}

export function BaseUrlSection({ form }: BaseUrlSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Provider endpoint</CardTitle>
        <CardDescription>
          Any OpenAI-compatible API. The key below must belong to this endpoint.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.Field name="aiProvider.baseUrl">
          {(field: AnyFieldApi) => <BaseUrlField field={field} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function BaseUrlField({ field }: { field: AnyFieldApi }) {
  // Local validation state: the shared SectionForm field wrapper does
  // not carry per-field validators, and this field is a plain string.
  const [touched, setTouched] = useState(false);
  const value = field.state.value as string;
  const invalid = touched && !z.url().safeParse(value).success;
  const name = field.name;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={name}>Base URL</FieldLabel>
      <Input
        id={name}
        name={name}
        type="url"
        value={value}
        onBlur={() => {
          setTouched(true);
          field.handleBlur();
        }}
        onChange={(e) => field.handleChange(e.target.value)}
        placeholder="https://openrouter.ai/api/v1"
      />
      {invalid && <FieldError>Enter a valid https:// URL.</FieldError>}
    </Field>
  );
}

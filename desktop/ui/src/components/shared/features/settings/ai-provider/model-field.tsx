import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { api } from '@/lib/api';
import type { AnyFieldApi } from './types';

/**
 * OpenAI model id field: a free-text input that additionally suggests the
 * model ids the effective API key can access. Suggestions come from a
 * single per-session query shared by both model fields; with no key
 * configured, an empty list, or a failed fetch, it stays a plain text
 * input so custom model ids are never locked out.
 */
export function ModelField({ field }: { field: AnyFieldApi }) {
  const [open, setOpen] = useState(false);
  const models = useQuery({
    queryKey: ['openai', 'models'],
    queryFn: api.listOpenAiModels,
    staleTime: Infinity,
  });

  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  const value = field.state.value as string;
  const available = models.data?.configured === true ? models.data.models : [];
  const suggestions = available.filter((model) =>
    model.toLowerCase().includes(value.toLowerCase()),
  );

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Model</FieldLabel>
      <Combobox
        items={suggestions}
        value={value}
        inputValue={value}
        onInputValueChange={(next) => {
          field.handleChange(next);
          setOpen(true);
        }}
        open={open && suggestions.length > 0}
        onOpenChange={setOpen}
        onValueChange={(selected) => {
          if (selected === null) return;
          field.handleChange(selected);
        }}
      >
        <ComboboxInput
          id={name}
          name={name}
          placeholder="e.g. gpt-5.6-sol"
          autoComplete="off"
          aria-invalid={isInvalid}
          onBlur={field.handleBlur}
        />
        <ComboboxContent>
          <ComboboxList>
            {(model) => (
              <ComboboxItem key={model} value={model}>
                {model}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

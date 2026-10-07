import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { OperationalConfigSchema } from '@jobhunter/core/config/schemas';
import { XIcon } from 'lucide-react';
import { useRef } from 'react';
import type { AnyFieldApi, SectionForm } from './types';

interface SearchQueriesSectionProps {
  form: SectionForm;
}

export function SearchQueriesSection({ form }: SearchQueriesSectionProps) {
  return (
    <form.Field name="search.searchQueries" mode="array">
      {(field: AnyFieldApi) => <SearchQueriesBody field={field} />}
    </form.Field>
  );
}

function SearchQueriesBody({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const values = field.state.value as string[];
  const inputRef = useRef<HTMLInputElement>(null);

  const draftForm = useForm({
    defaultValues: { query: '' },
    validators: {
      onSubmit: ({ value }) => {
        const trimmed = value.query.trim();
        if (trimmed === '') return 'Type a role title before adding.';
        return OperationalConfigSchema.shape.search.shape.searchQueries.element.safeParse(trimmed)
          .success
          ? undefined
          : 'Query must be a non-empty string.';
      },
    },
    onSubmit: ({ value }) => {
      const trimmed = value.query.trim();
      if (trimmed === '') return;
      field.pushValue(trimmed);
      draftForm.reset();
      inputRef.current?.focus();
    },
  });

  return (
    <>
      <CardHeader>
        <CardTitle>Search queries</CardTitle>
        <CardDescription>Target role titles</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={isInvalid} orientation="horizontal">
          {values.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No queries yet. Add at least one role title.
            </span>
          ) : (
            values.map((value, i) => (
              <Badge key={i} variant="outline">
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  onClick={() => field.removeValue(i)}
                  className="text-muted-foreground hover:text-destructive transition-all"
                >
                  <XIcon size={12} strokeWidth={2.5} data-icon="inline-end" />
                </button>
              </Badge>
            ))
          )}
        </Field>
        <FieldError errors={field.state.meta.errors} />

        <draftForm.Field name="query">
          {(draftField: AnyFieldApi) => {
            const draftInvalid = draftField.state.meta.isTouched && !draftField.state.meta.isValid;
            return (
              <>
                <Field data-invalid={draftInvalid} orientation="horizontal">
                  <Input
                    ref={inputRef}
                    id={draftField.name}
                    name={draftField.name}
                    value={draftField.state.value}
                    onBlur={draftField.handleBlur}
                    aria-invalid={draftInvalid}
                    type="text"
                    placeholder="Type a query and press Enter..."
                    autoComplete="off"
                    onChange={(e) => draftField.handleChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        draftForm.handleSubmit();
                      } else if (e.key === 'Escape') {
                        draftForm.reset();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => draftForm.handleSubmit()}
                  >
                    Add query
                  </Button>
                </Field>
                <FieldError errors={draftField.state.meta.errors} />
              </>
            );
          }}
        </draftForm.Field>
      </CardContent>
    </>
  );
}

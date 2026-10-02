import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { OperationalConfigSchema } from '@jobhunter/core/config/schemas';
import { XIcon } from 'lucide-react';
import { useRef } from 'react';
import type { AnyFieldApi, SectionForm } from './types';

interface RefusalDetectionSectionProps {
  form: SectionForm;
}

export function RefusalDetectionSection({ form }: RefusalDetectionSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Refusal detection</CardTitle>
        <CardDescription>Phrases that signal the model refused to answer.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="openai.refusalDetection.refusalMarkers" mode="array">
          {(field: AnyFieldApi) => <RefusalMarkersField field={field} />}
        </form.Field>

        <form.Field name="openai.refusalDetection.flagEmptyBodies">
          {(field: AnyFieldApi) => <FlagEmptyBodiesField field={field} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function RefusalMarkersField({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const values = field.state.value as string[];
  const inputRef = useRef<HTMLInputElement>(null);

  const draftForm = useForm({
    defaultValues: { marker: '' },
    validators: {
      onSubmit: ({ value }) => {
        const trimmed = value.marker.trim();
        if (trimmed === '') return 'Type a phrase before adding.';
        return OperationalConfigSchema.shape.openai.shape.refusalDetection.shape.refusalMarkers.element.safeParse(
          trimmed,
        ).success
          ? undefined
          : 'Marker must be a non-empty string.';
      },
    },
    onSubmit: ({ value }) => {
      const trimmed = value.marker.trim();
      if (trimmed === '') return;
      field.pushValue(trimmed);
      draftForm.reset();
      inputRef.current?.focus();
    },
  });

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel>Refusal markers</FieldLabel>
      {values.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No markers yet. Add at least one phrase.
        </span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {values.map((value, i) => (
            <Badge key={`${i}-${value}`} variant="outline">
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
          ))}
        </div>
      )}
      <FieldError errors={field.state.meta.errors} />

      <draftForm.Field name="marker">
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
                  placeholder='e.g. "as an AI"'
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
                <Button type="button" variant="secondary" onClick={() => draftForm.handleSubmit()}>
                  Add marker
                </Button>
              </Field>
              <FieldError errors={draftField.state.meta.errors} />
            </>
          );
        }}
      </draftForm.Field>
    </Field>
  );
}

function FlagEmptyBodiesField({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const checked = field.state.value as boolean;
  const id = field.name;
  return (
    <Field orientation="horizontal" data-invalid={isInvalid}>
      <Checkbox
        id={id}
        name={id}
        checked={checked}
        onCheckedChange={(next: boolean) => field.handleChange(next)}
        onBlur={field.handleBlur}
        aria-invalid={isInvalid}
      />
      <FieldLabel htmlFor={id}>Flag empty response bodies as refusals</FieldLabel>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

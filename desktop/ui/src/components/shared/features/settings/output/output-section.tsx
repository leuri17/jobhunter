import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import type {
  AnyFieldApi,
  SectionForm,
} from '@/components/shared/features/settings/search-config/types';

interface OutputSectionProps {
  form: SectionForm;
}

export function OutputSection({ form }: OutputSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Output</CardTitle>
        <CardDescription>
          Limits that shape what the pipeline keeps and what the UI shows by default.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="output.runTopN">
          {(field: AnyFieldApi) => (
            <PositiveIntRow
              field={field}
              label="Run top N"
              description="How many top-scored jobs a run keeps."
            />
          )}
        </form.Field>
      </CardContent>
      <SectionDivider />
      <CardContent className="flex flex-col gap-5">
        <form.Field name="output.jobsListDefaultLimit">
          {(field: AnyFieldApi) => (
            <PositiveIntRow
              field={field}
              label="Jobs list default limit"
              description="Default page size for the jobs list view."
            />
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

function PositiveIntRow({
  field,
  label,
  description,
}: {
  field: AnyFieldApi;
  label: string;
  description: string;
}) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        value={String(field.state.value)}
        onBlur={field.handleBlur}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '') {
            field.handleChange(Number.NaN);
            return;
          }
          const parsed = Number.parseInt(next, 10);
          field.handleChange(Number.isNaN(parsed) ? Number.NaN : parsed);
        }}
        aria-invalid={isInvalid}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

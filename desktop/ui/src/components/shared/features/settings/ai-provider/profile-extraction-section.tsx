import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REASONING_EFFORT_CHOICES, type ReasoningEffort } from '@jobhunter/core/config/labels';
import type { AiSectionForm, AnyFieldApi } from './types';

interface ProfileExtractionSectionProps {
  form: AiSectionForm;
}

export function ProfileExtractionSection({ form }: ProfileExtractionSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Profile extraction</CardTitle>
        <CardDescription>Model used during profile ingestion.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="openai.profileExtraction.model">
          {(field: AnyFieldApi) => <ModelField field={field} />}
        </form.Field>

        <form.Field name="openai.profileExtraction.reasoningEffort">
          {(field: AnyFieldApi) => <ReasoningEffortField field={field} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function ModelField({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Model</FieldLabel>
      <Input
        id={name}
        name={name}
        value={field.state.value as string}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        type="text"
        placeholder="e.g. gpt-5.6-sol"
        autoComplete="off"
      />
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

function ReasoningEffortField({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Reasoning effort</FieldLabel>
      <Select
        value={field.state.value as ReasoningEffort}
        onValueChange={(next: string | null) => {
          if (next !== null) field.handleChange(next as ReasoningEffort);
        }}
        items={REASONING_EFFORT_CHOICES}
      >
        <SelectTrigger className="w-full" id={name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {REASONING_EFFORT_CHOICES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { REASONING_EFFORT_CHOICES, type ReasoningEffort } from '@jobhunter/core/config/labels';
import { AI_PROVIDER_REASONING_EFFORT_IDS } from '@jobhunter/core/config/schemas';
import { ModelField } from './model-field';
import type { AnyFieldApi, SectionForm } from './types';
import { useSelectedAiProvider } from './use-selected-provider';

interface ProfileExtractionSectionProps {
  form: SectionForm;
}

export function ProfileExtractionSection({ form }: ProfileExtractionSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Profile extraction</CardTitle>
        <CardDescription>Model used during profile ingestion.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="aiProvider.profileExtraction.model">
          {(field: AnyFieldApi) => <ProviderModelField field={field} />}
        </form.Field>

        <form.Field name="aiProvider.profileExtraction.reasoningEffort">
          {(field: AnyFieldApi) => <ReasoningEffortField field={field} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function ProviderModelField({ field }: { field: AnyFieldApi }) {
  const aiProvider = useSelectedAiProvider(field);
  return <ModelField field={field} provider={aiProvider.provider} baseUrl={aiProvider.baseUrl} />;
}

function ReasoningEffortField({ field }: { field: AnyFieldApi }) {
  const aiProvider = useSelectedAiProvider(field);
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  if (!AI_PROVIDER_REASONING_EFFORT_IDS.includes(aiProvider.provider)) {
    // The provider ignores the parameter; the stored value is kept.
    return null;
  }
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

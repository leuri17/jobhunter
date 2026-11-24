import { useState } from 'react';
import { z } from 'zod';
import { AI_PROVIDER_CHOICES, type AiProviderId } from '@jobhunter/core/config/schemas';
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
import type { AnyFieldApi, SectionForm } from './types';

interface ProviderSectionProps {
  form: SectionForm;
}

export function ProviderSection({ form }: ProviderSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Provider</CardTitle>
        <CardDescription>
          The OpenAI-compatible service used for every AI step. The API key must belong to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.Field name="aiProvider.provider">
          {(field: AnyFieldApi) => <ProviderBody field={field} form={form} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function ProviderBody({ field, form }: { field: AnyFieldApi; form: SectionForm }) {
  const provider = field.state.value as AiProviderId;
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid} className="flex flex-col gap-5">
      <FieldLabel htmlFor={name}>AI provider</FieldLabel>
      <Select
        value={provider}
        onValueChange={(next: string | null) => {
          if (next === null) return;
          field.handleChange(next as AiProviderId);
          if (next === 'custom') {
            const existing = field.form.getFieldValue('aiProvider.baseUrl');
            field.form.setFieldValue(
              'aiProvider.baseUrl',
              typeof existing === 'string' ? existing : '',
            );
          } else {
            // The key must not survive a switch to a known provider —
            // the canonical schema rejects baseUrl alongside one.
            field.form.setFieldValue('aiProvider.baseUrl', undefined);
          }
        }}
        items={AI_PROVIDER_CHOICES}
      >
        <SelectTrigger className="w-full" id={name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {AI_PROVIDER_CHOICES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError errors={field.state.meta.errors} />
      {provider === 'custom' && (
        <form.Field name="aiProvider.baseUrl">
          {(urlField: AnyFieldApi) => <CustomBaseUrlField field={urlField} />}
        </form.Field>
      )}
    </Field>
  );
}

function CustomBaseUrlField({ field }: { field: AnyFieldApi }) {
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
        placeholder="https://your-endpoint.example/v1"
      />
      {invalid && <FieldError>Enter a valid https:// URL.</FieldError>}
    </Field>
  );
}

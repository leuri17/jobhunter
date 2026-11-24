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
import { AI_PROVIDER_CHOICES, type AiProviderId } from '@jobhunter/core/config/schemas';
import { apiKeyQueryOptions } from './api-key-query';
import type { AnyFieldApi } from './types';

/** Providers whose model catalog is public, so the list loads without a key. */
const PUBLIC_MODEL_LIST_IDS: ReadonlySet<AiProviderId> = new Set(['openrouter']);

export function modelsQueryKey(provider: AiProviderId, baseUrl?: string): readonly unknown[] {
  return baseUrl !== undefined && baseUrl.length > 0
    ? ['ai-provider', 'models', provider, baseUrl]
    : ['ai-provider', 'models', provider];
}

interface ModelFieldProps {
  readonly field: AnyFieldApi;
  /** The provider selected in the form — saved or not — whose models to list. */
  readonly provider: AiProviderId;
  /** Needed to list a `custom` provider; empty until the user types it. */
  readonly baseUrl: string | undefined;
}

function keyHint(provider: AiProviderId): string | null {
  if (provider === 'custom') return "Add a key above to list this endpoint's models.";
  const choice = AI_PROVIDER_CHOICES.find((item) => item.value === provider);
  return choice === undefined ? null : `Add a ${choice.label} key to list its models.`;
}

/**
 * AiProvider model id field: a free-text input that lists the model ids
 * the selected provider's key can access. The list follows the provider
 * chosen in the form (#359); with no key, an empty list, or a failed
 * fetch, it stays a plain text input so custom model ids are never
 * locked out.
 */
export function ModelField({ field, provider, baseUrl }: ModelFieldProps) {
  const [open, setOpen] = useState(false);
  const customMissingUrl = provider === 'custom' && (baseUrl === undefined || baseUrl === '');
  const models = useQuery({
    queryKey: modelsQueryKey(provider, baseUrl),
    queryFn: () =>
      api.listAiProviderModels(
        provider === 'custom' && baseUrl !== undefined ? { provider, baseUrl } : { provider },
      ),
    staleTime: Infinity,
    enabled: !customMissingUrl,
  });
  const keyStatus = useQuery(apiKeyQueryOptions(provider));

  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  const value = field.state.value as string;
  const available = models.data?.configured === true ? models.data.models : [];
  const hint =
    available.length === 0 &&
    keyStatus.data?.configured === false &&
    !PUBLIC_MODEL_LIST_IDS.has(provider)
      ? keyHint(provider)
      : null;

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Model</FieldLabel>
      <Combobox
        items={available}
        value={value}
        inputValue={value}
        onInputValueChange={(next) => {
          field.handleChange(next);
          setOpen(true);
        }}
        open={open && available.length > 0}
        onOpenChange={setOpen}
        onValueChange={(selected) => {
          if (selected === null) return;
          field.handleChange(selected);
        }}
      >
        <ComboboxInput
          id={name}
          name={name}
          showTrigger={available.length > 0}
          placeholder="e.g. gpt-5.6-sol"
          autoComplete="off"
          aria-invalid={isInvalid}
          onFocus={() => setOpen(true)}
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
      {hint !== null && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

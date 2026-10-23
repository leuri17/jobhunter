import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

const OUTCOME_COPY = {
  rejected:
    'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.',
  unreachable: "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.",
} as const;

type ValidationOutcome = {
  readonly status: keyof typeof OUTCOME_COPY;
  readonly reason?: string | undefined;
  readonly configured: boolean;
};

export function ApiKeySection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [outcome, setOutcome] = useState<ValidationOutcome | null>(null);

  const status = useQuery({
    queryKey: ['secrets', 'api-key'],
    queryFn: api.getApiKeyStatus,
  });

  const save = useMutation({
    mutationFn: (apiKey: string) => api.setApiKey(apiKey),
    onSuccess: (result) => {
      if (result.status !== 'validated') {
        setOutcome({ status: result.status, reason: result.reason, configured: result.configured });
        return;
      }
      setOutcome(null);
      void queryClient.invalidateQueries({ queryKey: ['secrets', 'api-key'] });
      setDraft('');
      toast.add({
        title: 'API key saved',
        description: `Stored as ${result.masked}`,
        type: 'success',
      });
    },
    onError: (err: unknown) => {
      const apiError = err as ApiError;
      toast.add({
        title: 'Could not save the API key',
        description: `${apiError.status} ${apiError.code} - ${apiError.message}`,
        type: 'error',
      });
    },
  });

  const clear = useMutation({
    mutationFn: () => api.clearApiKey(),
    onSuccess: () => {
      setOutcome(null);
      void queryClient.invalidateQueries({ queryKey: ['secrets', 'api-key'] });
      setDraft('');
      toast.add({ title: 'API key removed', type: 'success' });
    },
    onError: (err: unknown) => {
      const apiError = err as ApiError;
      toast.add({
        title: 'Could not remove the API key',
        description: `${apiError.status} ${apiError.code} - ${apiError.message}`,
        type: 'error',
      });
    },
  });

  const state = status.data;
  const fromEnvironment = state?.source === 'environment';
  const busy = save.isPending || clear.isPending;

  return (
    <>
      <CardHeader>
        <CardTitle>OpenAI API key</CardTitle>
        <CardDescription>Required for profile extraction and job scoring.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {fromEnvironment && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Using <code className="font-mono">OPENAI_API_KEY</code> from your environment. Saving a
            key here overrides it.
          </p>
        )}

        <Field>
          <FieldLabel htmlFor="openai-api-key">Key</FieldLabel>
          <Input
            id="openai-api-key"
            type="password"
            autoComplete="off"
            placeholder={state?.configured ? `Stored: ${state.masked}` : 'sk-...'}
            value={draft}
            disabled={busy}
            aria-invalid={outcome !== null}
            onChange={(e) => {
              setDraft(e.target.value);
              setOutcome(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {state?.configured
              ? 'Stored on this machine. Type a new key to replace it.'
              : 'Paste a key from platform.openai.com. It is never sent back to this app.'}
          </p>
          {outcome !== null && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <p>
                {outcome.status === 'rejected' && !outcome.configured
                  ? 'OpenAI rejected this key. Nothing was saved.'
                  : OUTCOME_COPY[outcome.status]}
              </p>
              {outcome.reason !== undefined && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">More info</summary>
                  <code className="font-mono">{outcome.reason}</code>
                </details>
              )}
            </div>
          )}
        </Field>

        <div className="flex gap-2">
          <Button
            type="button"
            disabled={busy || draft.trim().length === 0}
            onClick={() => save.mutate(draft.trim())}
          >
            {save.isPending ? 'Validating key…' : 'Save key'}
          </Button>
          {state?.source === 'stored' && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => clear.mutate()}>
              {clear.isPending ? 'Removing...' : 'Remove key'}
            </Button>
          )}
        </div>
      </CardContent>
    </>
  );
}

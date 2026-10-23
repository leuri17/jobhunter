import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { ActionGuidance } from '@/lib/error-surfaces';

const REJECTED_WITH_KEY =
  'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.';
const REJECTED_WITHOUT_KEY = 'OpenAI rejected this key. Nothing was saved.';
const UNREACHABLE = "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.";

const REJECTED_CODES: ReadonlySet<string> = new Set([
  'openai_authentication',
  'openai_permission',
  'openai_billing',
]);

function saveGuidanceFor(error: ApiError, configured: boolean): ActionGuidance {
  const rejected = REJECTED_CODES.has(error.code);
  return {
    message: rejected ? (configured ? REJECTED_WITH_KEY : REJECTED_WITHOUT_KEY) : UNREACHABLE,
    // Inert: the section passes no onAction, so the dialog renders Close only.
    actionLabel: 'Close',
  };
}

export function ApiKeySection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  const status = useQuery({
    queryKey: ['secrets', 'api-key'],
    queryFn: api.getApiKeyStatus,
  });

  const save = useMutation({
    mutationFn: (apiKey: string) => api.setApiKey(apiKey),
    onSuccess: (result) => {
      setSaveError(null);
      void queryClient.invalidateQueries({ queryKey: ['secrets', 'api-key'] });
      setDraft('');
      toast.add({
        title: 'API key saved',
        description: `Stored as ${result.masked}`,
        type: 'success',
      });
    },
    onError: (err: unknown) => {
      setSaveError(err as ApiError);
    },
  });

  const clear = useMutation({
    mutationFn: () => api.clearApiKey(),
    onSuccess: () => {
      setSaveError(null);
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
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {state?.configured
              ? 'Stored on this machine. Type a new key to replace it.'
              : 'Paste a key from platform.openai.com. It is never sent back to this app.'}
          </p>
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
      <ApiErrorDialog
        error={saveError}
        title="Couldn't save the API key"
        guidance={
          saveError !== null ? saveGuidanceFor(saveError, state?.configured ?? false) : undefined
        }
        onDismiss={() => setSaveError(null)}
      />
    </>
  );
}

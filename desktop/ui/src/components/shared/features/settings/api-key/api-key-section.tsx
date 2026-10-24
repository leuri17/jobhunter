import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LockIcon, TerminalIcon, TriangleAlertIcon } from 'lucide-react';

import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { ApiKeyResponse } from '@/lib/types';
import type { ActionGuidance } from '@/lib/error-surfaces';

const REJECTED_WITH_KEY =
  'OpenAI rejected this key. Nothing was saved — the previously configured key is still active.';
const REJECTED_WITHOUT_KEY = 'OpenAI rejected this key. Nothing was saved.';
const UNREACHABLE = "Couldn't reach OpenAI to validate the key. Nothing was saved — try again.";
const KEYCHAIN_GONE =
  'The OS keychain is not available right now, so nothing was saved. Try again in a moment.';
const MIGRATE_FAILED = 'The old secrets file was left unchanged. You can try again.';

const REJECTED_CODES: ReadonlySet<string> = new Set([
  'openai_authentication',
  'openai_permission',
  'openai_billing',
]);

function saveGuidanceFor(error: ApiError, configured: boolean): ActionGuidance {
  if (error.code === 'secrets_backend_unavailable') {
    return {
      message: KEYCHAIN_GONE,
      // Inert: the section passes no onAction, so the dialog renders Close only.
      actionLabel: 'Close',
    };
  }
  const rejected = REJECTED_CODES.has(error.code);
  return {
    message: rejected ? (configured ? REJECTED_WITH_KEY : REJECTED_WITHOUT_KEY) : UNREACHABLE,
    // Inert: the section passes no onAction, so the dialog renders Close only.
    actionLabel: 'Close',
  };
}

/**
 * The 409 envelope's message is already written for the user (nothing
 * changed; the keychain keeps the active key), so it is shown verbatim
 * instead of generic retry copy.
 */
function migrateGuidanceFor(error: ApiError): ActionGuidance {
  if (error.code === 'legacy_shadowed') {
    return { message: error.message, actionLabel: 'Close' };
  }
  return { message: MIGRATE_FAILED, actionLabel: 'Close' };
}

/** Where a key lives on this machine, under the input it applies to. */
function BackendStatusLine({ state }: { readonly state: ApiKeyResponse }) {
  if (state.backend === 'keychain') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LockIcon aria-hidden="true" className="size-3" />
        Stored in your OS keychain.
      </p>
    );
  }
  if (state.backendReason === 'keychain_unavailable') {
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        No OS keychain is available on this machine, so a saved key is written to a local secrets
        file. The file is protected by its permissions, not by OS encryption.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <TerminalIcon aria-hidden="true" className="size-3" />
      Running without the desktop shell, so keys are stored in a local file instead of the OS
      keychain.
    </p>
  );
}

export function ApiKeySection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [migrateError, setMigrateError] = useState<ApiError | null>(null);
  const [pendingPlaintextKey, setPendingPlaintextKey] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['secrets', 'api-key'],
    queryFn: api.getApiKeyStatus,
  });

  const save = useMutation({
    mutationFn: (vars: { readonly apiKey: string; readonly allowPlaintextFallback: boolean }) =>
      api.setApiKey(vars.apiKey, vars.allowPlaintextFallback),
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

  const migrate = useMutation({
    mutationFn: () => api.migrateApiKey(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['secrets', 'api-key'] });
      if (result.migrated) {
        toast.add({
          title: 'Key moved to the OS keychain',
          description: `Stored as ${result.masked}`,
          type: 'success',
        });
        return;
      }
      toast.add({
        title: 'The key was not moved',
        description:
          result.reason === 'nothing_to_migrate'
            ? 'The old secrets file no longer holds a key, so there was nothing to move.'
            : 'The OS keychain is not available right now. The old secrets file is unchanged.',
        type: 'warning',
      });
    },
    onError: (err: unknown) => {
      setMigrateError(err as ApiError);
    },
  });

  const state = status.data;
  const fromEnvironment = state?.source === 'environment';
  const legacyFileToMigrate = state?.legacyFilePresent === true && state.backend === 'keychain';
  const plaintextFallbackLoaded =
    state?.backend === 'file' && state.backendReason === 'keychain_unavailable';
  // Saving routes through the consent dialog or not depending on the
  // loaded backend, so the submit stays disabled until it is known.
  const backendKnown = state !== undefined;
  const busy = save.isPending || clear.isPending;

  function submitDraft(): void {
    const key = draft.trim();
    if (plaintextFallbackLoaded) {
      setPendingPlaintextKey(key);
      return;
    }
    save.mutate({ apiKey: key, allowPlaintextFallback: false });
  }

  function confirmPlaintextSave(): void {
    const key = pendingPlaintextKey;
    setPendingPlaintextKey(null);
    if (key === null) return;
    save.mutate({ apiKey: key, allowPlaintextFallback: true });
  }

  return (
    <>
      <CardHeader>
        <CardTitle>OpenAI API key</CardTitle>
        <CardDescription>Required for profile extraction and job scoring.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {legacyFileToMigrate && (
          <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p>
              An old plaintext secrets file still holds a saved API key. Move it into the OS
              keychain; the file is deleted after the move.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={migrate.isPending}
              onClick={() => migrate.mutate()}
            >
              {migrate.isPending ? 'Moving…' : 'Move to keychain'}
            </Button>
          </div>
        )}

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
          {state !== undefined && <BackendStatusLine state={state} />}
        </Field>

        <div className="flex gap-2">
          <Button
            type="button"
            disabled={busy || !backendKnown || draft.trim().length === 0}
            onClick={() => submitDraft()}
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
      <ApiErrorDialog
        error={migrateError}
        title="Couldn't move the key to the OS keychain"
        guidance={migrateError !== null ? migrateGuidanceFor(migrateError) : undefined}
        onDismiss={() => setMigrateError(null)}
      />
      <AlertDialog
        open={pendingPlaintextKey !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlaintextKey(null);
        }}
      >
        <AlertDialogContent size="sm" data-testid="plaintext-consent-dialog">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-amber-500/20 text-amber-600">
              <TriangleAlertIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Save the key to a local file?</AlertDialogTitle>
            <AlertDialogDescription>
              No OS keychain is available on this machine. The key will be written to a plaintext
              secrets file, protected by its file permissions — not by OS-level encryption. Anything
              that can read your files can read the key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPlaintextSave}>Save to file</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

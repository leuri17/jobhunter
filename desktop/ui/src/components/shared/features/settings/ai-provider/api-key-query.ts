import { queryOptions } from '@tanstack/react-query';
import type { AiProviderId } from '@jobhunter/core/config';
import { api } from '@/lib/api';

/**
 * One cached key status per provider, shared by the key block and the
 * model fields (#359) so both observe the same save/remove.
 */
export function apiKeyQueryOptions(provider: AiProviderId) {
  return queryOptions({
    queryKey: ['secrets', 'api-key', provider],
    queryFn: () => api.getApiKeyStatus(provider),
  });
}

/**
 * Key status for the provider the SAVED config selects — the one a run
 * actually uses. Pages that only gate on "is a key configured" want
 * this, not a provider someone has merely chosen in a form.
 */
export function savedProviderApiKeyQueryOptions() {
  return queryOptions({
    queryKey: ['api-key'],
    queryFn: () => api.getApiKeyStatus(),
  });
}

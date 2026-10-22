import { useState } from 'react';
import { PageHeader, PageHeaderTitle } from '@/components/shared/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import type { ConfigResponse } from '@/lib/types';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { OperationalConfigSchema } from '@jobhunter/core/config/schemas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { SearchQueriesSection } from '@/components/shared/features/settings/search-config/search-queries-section';
import { LocationsSection } from '@/components/shared/features/settings/search-config/locations-section';
import { DatePostedSection } from '@/components/shared/features/settings/search-config/date-posted-section';
import { WorkplaceTypesSection } from '@/components/shared/features/settings/search-config/workplace-types-section';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import { ProfileExtractionSection } from '@/components/shared/features/settings/ai-provider/profile-extraction-section';
import { JobScoringSection } from '@/components/shared/features/settings/ai-provider/job-scoring-section';
import { ApiKeySection } from '@/components/shared/features/settings/api-key/api-key-section';
import { OutputSection } from '@/components/shared/features/settings/output/output-section';
import { AdvancedSection } from '@/components/shared/features/settings/advanced/advanced-section';

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
});

function RouteComponent() {
  const config = useSuspenseQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  const form = useForm({
    defaultValues: config.data.config,
    validators: { onChange: OperationalConfigSchema },
    onSubmit: async ({ value }) => {
      try {
        await api.patchConfig(value);
        await queryClient.invalidateQueries({ queryKey: ['config'] });
        // defaultValues are read once on first render, so the form never
        // picks up the refetched config on its own — re-baseline against
        // the cache that invalidateQueries just refreshed.
        form.reset(queryClient.getQueryData<ConfigResponse>(['config'])!.config);

        toast.add({
          title: 'Search configuration updated successfully',
          type: 'success',
        });
      } catch (err: unknown) {
        setSaveError(err as ApiError);
      }
    },
  });

  return (
    // TODO: Create Page & PageContent component
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="AI provider, search criteria, and scraping limits.">
          Settings
        </PageHeaderTitle>
      </PageHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <Tabs defaultValue="search">
          <TabsList variant="line">
            <TabsTrigger value="search">Search configuration</TabsTrigger>
            <TabsTrigger value="ai">AI Provider</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
          <TabsContent value="search">
            <Card>
              <SearchQueriesSection form={form} />
              <SectionDivider />
              <LocationsSection form={form} />
              <SectionDivider />
              <DatePostedSection form={form} />
              <SectionDivider />
              <WorkplaceTypesSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="ai">
            <Card>
              <ApiKeySection />
              <SectionDivider />
              <ProfileExtractionSection form={form} />
              <SectionDivider />
              <JobScoringSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="output">
            <Card>
              <OutputSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="advanced">
            <Card>
              <AdvancedSection form={form} />
            </Card>
          </TabsContent>
        </Tabs>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting, s.isDirty] as const}>
          {([canSubmit, isSubmitting, isDirty]) => (
            <div className="sticky bottom-0 flex items-center gap-3 bg-background/95 p-4 backdrop-blur">
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save settings'}
              </Button>
              {!isDirty && <span className="text-xs text-muted-foreground">No changes</span>}
            </div>
          )}
        </form.Subscribe>
      </form>

      <ApiErrorDialog
        error={saveError}
        title="Couldn't save settings"
        onDismiss={() => setSaveError(null)}
      >
        <p className="text-sm text-muted-foreground">
          Nothing was saved. Your edits are still in the form.
        </p>
      </ApiErrorDialog>
    </div>
  );
}

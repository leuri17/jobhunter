import { PageHeader, PageHeaderTitle } from '@/components/shared/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import { OperationalConfigSchema } from '@jobhunter/core/config/schemas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { SearchQueriesSection } from '@/components/shared/features/settings/search-config/search-queries-section';
import { LocationsSection } from '@/components/shared/features/settings/search-config/locations-section';
import { DatePostedSection } from '@/components/shared/features/settings/search-config/date-posted-section';
import { WorkplaceTypesSection } from '@/components/shared/features/settings/search-config/workplace-types-section';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import { ProfileExtractionSection } from '@/components/shared/features/settings/ai-provider/profile-extraction-section';
import { JobScoringSection } from '@/components/shared/features/settings/ai-provider/job-scoring-section';
import { RefusalDetectionSection } from '@/components/shared/features/settings/ai-provider/refusal-detection-section';

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
});

function RouteComponent() {
  const config = useSuspenseQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });

  const form = useForm({
    defaultValues: config.data.config,
    validators: { onChange: OperationalConfigSchema },
    onSubmit: async ({ value }) => {
      try {
        await api.patchConfig(value);

        toast.add({
          title: 'Search configuration updated successfully',
          type: 'success',
        });
      } catch (err: unknown) {
        toast.add({
          title: 'Search configuration update failed',
          description: `${(err as ApiError).status} - ${(err as ApiError).message}`,
          type: 'error',
        });
      }
    },
  });

  return (
    // TODO: Create Page & PageContent component
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="AI provider, score thresholds, scraping limits. API keys are read from your .env file.">
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
            <TabsTrigger value="scrapper">Scrapper</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="logging">Logging</TabsTrigger>
            <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
          </TabsList>
          <TabsContent value="search">
            <Card>
              <form.Field name="search.searchQueries" mode="array">
                {(field) => <SearchQueriesSection field={field} />}
              </form.Field>
              <SectionDivider />

              <form.Field name="search.locations" mode="array">
                {(field) => <LocationsSection field={field} />}
              </form.Field>
              <SectionDivider />

              <form.Field name="search.datePosted">
                {(field) => <DatePostedSection field={field} />}
              </form.Field>
              <SectionDivider />

              <form.Field name="search.workplaceTypes" mode="array">
                {(field) => <WorkplaceTypesSection field={field} />}
              </form.Field>
            </Card>
          </TabsContent>
          <TabsContent value="ai">
            <Card>
              <ProfileExtractionSection form={form} />
              <SectionDivider />
              <JobScoringSection form={form} />
              <SectionDivider />
              <RefusalDetectionSection form={form} />
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
    </div>
  );
}

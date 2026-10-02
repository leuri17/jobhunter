import { PageHeader, PageHeaderTitle } from '@/components/shared/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from '@tanstack/react-form';
import {
  DEFAULT_OPERATIONAL_CONFIG,
  OperationalConfigSchema,
} from '@jobhunter/core/config/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Building2, Cloud, House, InfoIcon, Trash, XIcon } from 'lucide-react';
import { Field, FieldError } from '@/components/ui/field';
import { cn } from 'cn';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableRow, TableBody, TableCell } from '@/components/ui/table';
import LocationPicker from '@/components/shared/features/settings/search-config/location-picker';
import { WORKPLACE_TYPE_CHOICES } from '@jobhunter/core/search';
import {
  Select,
  SelectItem,
  SelectGroup,
  SelectContent,
  SelectValue,
  SelectTrigger,
} from '@/components/ui/select';
import { Item, ItemContent, ItemTitle, ItemMedia } from '@/components/ui/item';

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
});

function RouteComponent() {
  const config = useSuspenseQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });

  const form = useForm({
    defaultValues: config.data ? config.data.config : DEFAULT_OPERATIONAL_CONFIG,
    validators: { onChange: OperationalConfigSchema },
    onSubmit: async ({ value }) => {
      console.log(`SETTINGS FORM SUBMIT: ${JSON.stringify(value)}`);
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

  const searchQueryInputForm = useForm({
    defaultValues: {
      searchQuery: '',
    },
    onSubmit: async ({ value }) => {
      form.pushFieldValue('search.searchQueries', value.searchQuery);
    },
  });

  const items = [
    { label: 'Past 24 hours', value: 86400 },
    { label: 'Past week', value: 604800 },
    { label: 'Past month', value: 2592000 },
  ];

  return (
    // TODO: Create Page & PageContent component
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="AI provider, score thresholds, scraping limits. API keys are read from your .env file.">
          Settings
        </PageHeaderTitle>
        {/* <PageHeaderAction type="button" variant="outline">
          Re-run setup wizard
        </PageHeaderAction> */}
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
              {/* SEARCH QUERIES */}
              <CardHeader>
                <CardTitle>Search queries</CardTitle>
                <CardDescription>Target role titles</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <form.Field
                  name="search.searchQueries"
                  mode="array"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                    return (
                      <>
                        <Field data-invalid={isInvalid} orientation="horizontal">
                          {field.state.value.map((_, i) => (
                            <form.Field
                              key={i}
                              name={`search.searchQueries[${i}]`}
                              children={(subField) => (
                                <Badge variant="outline">
                                  {subField.state.value}
                                  <button
                                    type="button"
                                    aria-label={`Remove ${subField.state.value}`}
                                    onClick={() => field.removeValue(i)}
                                    className="text-muted-foreground hover:text-destructive transition-all"
                                  >
                                    <XIcon size={12} strokeWidth={2.5} data-icon="inline-end" />
                                  </button>
                                </Badge>
                              )}
                            />
                          ))}
                        </Field>
                        <FieldError errors={field.state.meta.errors} />
                      </>
                    );
                  }}
                />

                <searchQueryInputForm.Field
                  name="searchQuery"
                  validators={{
                    onSubmit: OperationalConfigSchema.shape.search.shape.searchQueries.element,
                  }}
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                    return (
                      <>
                        <Field data-invalid={isInvalid} orientation="horizontal">
                          <Input
                            id={field.name}
                            name={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            aria-invalid={isInvalid}
                            type="text"
                            placeholder="Type a query and press Enter..."
                            autoComplete="off"
                            onChange={(e) => field.handleChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                searchQueryInputForm.handleSubmit();
                              } else if (e.key === 'Escape') {
                                searchQueryInputForm.reset();
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={searchQueryInputForm.handleSubmit}
                          >
                            Add query
                          </Button>
                        </Field>
                        <FieldError errors={field.state.meta.errors} />
                      </>
                    );
                  }}
                />
              </CardContent>
              {/* SEARCH QUERIES */}

              <div className="px-4 my-6">
                <Separator />
              </div>

              {/* LOCATIONS */}
              <CardHeader>
                <CardTitle>Locations</CardTitle>
                <CardDescription>
                  LinkedIn locations to search. At least one is required for the pipeline to run.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <form.Field
                  name="search.locations"
                  mode="array"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                    return (
                      <>
                        <Field data-invalid={isInvalid}>
                          <Table>
                            <TableBody>
                              {field.state.value.map((_, i) => (
                                <form.Field
                                  key={i}
                                  name={`search.locations[${i}]`}
                                  children={(subField) => (
                                    <TableRow>
                                      <TableCell className="flex flex-col">
                                        {subField.state.value.name}
                                        <span className="text-xs text-muted-foreground">
                                          {subField.state.value.geoId}
                                        </span>
                                      </TableCell>
                                      <TableCell className="w-4">
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          aria-label={`Remove ${subField.state.value.geoId}`}
                                          onClick={() => field.removeValue(i)}
                                        >
                                          <Trash />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  )}
                                />
                              ))}
                            </TableBody>
                          </Table>
                        </Field>

                        <FieldError errors={field.state.meta.errors} />
                      </>
                    );
                  }}
                />

                <LocationPicker
                  onSelect={(loc) => {
                    if (!form.getFieldValue('search.locations').map((l) => l.geoId === loc.geoId))
                      form.pushFieldValue('search.locations', loc);
                  }}
                />
              </CardContent>
              {/* LOCATIONS */}

              <div className="px-4 my-6">
                <Separator />
              </div>

              {/* DATE POSTED */}
              <CardHeader>
                <CardTitle>Date posted</CardTitle>
                <CardDescription>Maximum job post age</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <form.Field
                  name="search.datePosted"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

                    return (
                      <>
                        <Field data-invalid={isInvalid} orientation="horizontal">
                          <Select items={items} defaultValue={86400}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {items.map((item) => (
                                  <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <Item variant="outline">
                            <ItemMedia variant="icon">
                              <InfoIcon />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>Freshness filter set to posts</ItemTitle>
                            </ItemContent>
                          </Item>
                        </Field>

                        <FieldError errors={field.state.meta.errors} />
                      </>
                    );
                  }}
                />
              </CardContent>
              {/* DATE POSTED */}

              <div className="px-4 my-6">
                <Separator />
              </div>

              {/* WORKPLACE TYPES */}
              <CardHeader>
                <CardTitle>Workplace types</CardTitle>
                <CardDescription>
                  Filter by workplace setting. Standard IDs match upstream job listing parameters.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <form.Field
                  name="search.workplaceTypes"
                  mode="array"
                  children={(field) => {
                    const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    const selected = field.state.value;
                    const workplaceIcons: Record<string, typeof Building2> = {
                      '1': Building2,
                      '2': Cloud,
                      '3': House,
                    };

                    return (
                      <>
                        <Field data-invalid={isInvalid}>
                          <div className="flex flex-col gap-3">
                            <div
                              role="group"
                              aria-label="Workplace types"
                              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                            >
                              {WORKPLACE_TYPE_CHOICES.map((choice) => {
                                const isSelected = selected.includes(choice.value);
                                const Icon = workplaceIcons[choice.value] ?? Building2;
                                return (
                                  <button
                                    key={choice.value}
                                    type="button"
                                    aria-pressed={isSelected}
                                    aria-label={`${choice.label} (value ${choice.value})`}
                                    onClick={() => {
                                      if (isSelected) {
                                        const idx = selected.indexOf(choice.value);
                                        if (idx >= 0) field.removeValue(idx);
                                      } else {
                                        field.pushValue(choice.value);
                                      }
                                    }}
                                    className={cn(
                                      'group/wt flex items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                                      'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                                      isSelected
                                        ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/40'
                                        : 'border-border bg-card/40 hover:border-foreground/20',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                                        isSelected
                                          ? 'bg-primary/15 text-primary'
                                          : 'bg-muted text-muted-foreground',
                                      )}
                                    >
                                      <Icon className="size-4" aria-hidden="true" />
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                      <span className="text-sm font-medium leading-tight">
                                        {choice.label}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </Field>
                        <FieldError errors={field.state.meta.errors} />
                      </>
                    );
                  }}
                />
              </CardContent>
              {/* WORKPLACE TYPES */}
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

      {/* <section>
        <h2 className="text-sm uppercase tracking-wide text-zinc-400 mb-2">Search configuration</h2>
        {config.data === undefined ? (
          <p>loading…</p>
        ) : (
          <pre className="rounded border border-border bg-card p-4 text-xs overflow-auto">
            {JSON.stringify(config.data.config, null, 2)}
          </pre>
        )}
      </section> */}
    </div>
  );
}

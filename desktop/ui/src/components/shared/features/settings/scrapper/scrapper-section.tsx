import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type {
  AnyFieldApi,
  SectionForm,
} from '@/components/shared/features/settings/search-config/types';

interface ScrapperSectionProps {
  form: SectionForm;
}

interface ScrapperField {
  name: string;
  label: string;
  description: string;
}

const SCRAPER_FIELDS: readonly ScrapperField[] = [
  {
    name: 'scraper.timeouts.navigationMs',
    label: 'Navigation timeout',
    description: 'Max time to wait for a page to load.',
  },
  {
    name: 'scraper.timeouts.initialResultsMs',
    label: 'Initial results',
    description: 'Max time to wait for the first results list.',
  },
  {
    name: 'scraper.timeouts.detailPanelMs',
    label: 'Detail panel',
    description: 'Max time to wait for the job detail panel.',
  },
  {
    name: 'scraper.timeouts.dedicatedPageMs',
    label: 'Dedicated page',
    description: 'Max time to wait for a dedicated job page.',
  },
  {
    name: 'scraper.timeouts.overlayDismissalMs',
    label: 'Overlay dismissal',
    description: 'Max time to wait for overlays to dismiss.',
  },
  {
    name: 'scraper.maxNoProgressAttempts',
    label: 'Max no-progress attempts',
    description: 'Give up after this many scraper turns without progress.',
  },
];

export function ScrapperSection({ form }: ScrapperSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Scrapper</CardTitle>
        <CardDescription>Browser timeouts and retry budget for LinkedIn scraping.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {SCRAPER_FIELDS.map((sf) => (
            <form.Field key={sf.name} name={sf.name}>
              {(field: AnyFieldApi) => (
                <PositiveIntRow field={field} label={sf.label} description={sf.description} />
              )}
            </form.Field>
          ))}
        </div>
        <form.Field name="scraper.headless">
          {(field: AnyFieldApi) => (
            <HeadlessRow
              field={field}
              label="Headless browser"
              description="Show the browser window while scraping. Useful for debugging; slightly slower."
            />
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

function HeadlessRow({
  field,
  label,
  description,
}: {
  field: AnyFieldApi;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/40 p-4">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">{label}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={field.state.value === true}
        onCheckedChange={(checked) => field.handleChange(checked)}
        onBlur={field.handleBlur}
        aria-label={label}
      />
    </div>
  );
}

function PositiveIntRow({
  field,
  label,
  description,
}: {
  field: AnyFieldApi;
  label: string;
  description: string;
}) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        value={String(field.state.value)}
        onBlur={field.handleBlur}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '') {
            field.handleChange(Number.NaN);
            return;
          }
          const parsed = Number.parseInt(next, 10);
          field.handleChange(Number.isNaN(parsed) ? Number.NaN : parsed);
        }}
        aria-invalid={isInvalid}
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

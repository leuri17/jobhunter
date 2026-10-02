import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import type {
  AnyFieldApi,
  SectionForm,
} from '@/components/shared/features/settings/search-config/types';

interface DiagnosisSectionProps {
  form: SectionForm;
}

interface CaptureToggle {
  name: string;
  label: string;
  description: string;
}

const CAPTURE_TOGGLES: readonly CaptureToggle[] = [
  {
    name: 'diagnostics.onScraperError.screenshot',
    label: 'Screenshot',
    description: 'Capture a PNG of the page when the scraper fails.',
  },
  {
    name: 'diagnostics.onScraperError.currentUrl',
    label: 'Current URL',
    description: 'Record the URL the scraper was on when it failed.',
  },
  {
    name: 'diagnostics.onScraperError.stackTrace',
    label: 'Stack trace',
    description: 'Include the failing call stack in the report.',
  },
  {
    name: 'diagnostics.onScraperError.playwrightTrace',
    label: 'Playwright trace',
    description: 'Save a Playwright trace zip for replay.',
  },
  {
    name: 'diagnostics.onScraperError.htmlSnapshot',
    label: 'HTML snapshot',
    description: 'Save the page HTML at the moment of failure.',
  },
];

export function DiagnosisSection({ form }: DiagnosisSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Diagnosis</CardTitle>
        <CardDescription>What to capture when the scraper fails.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {CAPTURE_TOGGLES.map((t) => (
            <form.Field key={t.name} name={t.name}>
              {(field: AnyFieldApi) => (
                <CaptureToggleRow field={field} label={t.label} description={t.description} />
              )}
            </form.Field>
          ))}
        </div>
      </CardContent>
    </>
  );
}

function CaptureToggleRow({
  field,
  label,
  description,
}: {
  field: AnyFieldApi;
  label: string;
  description: string;
}) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const checked = field.state.value as boolean;
  const id = field.name;
  return (
    <Field orientation="horizontal" data-invalid={isInvalid}>
      <Checkbox
        id={id}
        name={id}
        checked={checked}
        onCheckedChange={(next: boolean) => field.handleChange(next)}
        onBlur={field.handleBlur}
        aria-invalid={isInvalid}
      />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

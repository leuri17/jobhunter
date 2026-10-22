import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOG_LEVEL_CHOICES, type LogLevel } from '@jobhunter/core/config/labels';
import type {
  AnyFieldApi,
  SectionForm,
} from '@/components/shared/features/settings/search-config/types';

interface LoggingSectionProps {
  form: SectionForm;
}

export function LoggingSection({ form }: LoggingSectionProps) {
  return (
    <>
      <CardHeader>
        <CardTitle>Logging</CardTitle>
        <CardDescription>
          Sidecar log level and terminal formatting. Logs are always written to a rolling file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="logging.level">
          {(field: AnyFieldApi) => <LevelRow field={field} />}
        </form.Field>

        <form.Field name="logging.prettyTerminal">
          {(field: AnyFieldApi) => <PrettyTerminalRow field={field} />}
        </form.Field>
      </CardContent>
    </>
  );
}

function LevelRow({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Log level</FieldLabel>
      <Select
        value={field.state.value as LogLevel}
        onValueChange={(next: string | null) => {
          if (next !== null) field.handleChange(next as LogLevel);
        }}
        items={LOG_LEVEL_CHOICES}
      >
        <SelectTrigger className="w-full" id={name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {LOG_LEVEL_CHOICES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError errors={field.state.meta.errors} />
      <p className="text-xs text-muted-foreground">
        A threshold, not a category: the log shows the selected level and everything more severe.
        When something went wrong, <code className="font-mono">warn</code> or above is usually what
        you want — <code className="font-mono">error</code> hides all warnings.
      </p>
      <p className="text-xs text-muted-foreground">
        Applies on restart and overrides <code className="font-mono">LOG_LEVEL</code> in your
        environment. Remove the variable if you want this to be the only source.
      </p>
    </Field>
  );
}

function PrettyTerminalRow({ field }: { field: AnyFieldApi }) {
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
      <FieldLabel htmlFor={id}>Pretty terminal output</FieldLabel>
      <p className="text-xs text-muted-foreground">
        Render logs as colored lines instead of raw JSON.
      </p>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

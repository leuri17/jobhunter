import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOG_LEVEL_CHOICES, type LogLevel } from '@jobhunter/core/config/labels';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
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
        <CardDescription>Sidecar log level, formatting, and optional file sink.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="logging.level">
          {(field: AnyFieldApi) => <LevelRow field={field} />}
        </form.Field>

        <form.Field name="logging.prettyTerminal">
          {(field: AnyFieldApi) => <PrettyTerminalRow field={field} />}
        </form.Field>
      </CardContent>
      <SectionDivider />
      <CardContent className="flex flex-col gap-5">
        <form.Field name="logging.filePath">
          {(field: AnyFieldApi) => <FilePathRow field={field} />}
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

function FilePathRow({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const name = field.name;
  const raw = field.state.value as string | undefined;
  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={name}>Log file path</FieldLabel>
      <Input
        id={name}
        name={name}
        value={raw ?? ''}
        onBlur={field.handleBlur}
        onChange={(e) => {
          const next = e.target.value;
          field.handleChange(next === '' ? undefined : next);
        }}
        aria-invalid={isInvalid}
        type="text"
        placeholder="Leave empty to log to stdout only."
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        Optional. Absolute path for the rolling log file.
      </p>
      <FieldError errors={field.state.meta.errors} />
    </Field>
  );
}

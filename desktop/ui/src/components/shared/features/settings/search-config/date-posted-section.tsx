import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import {
  DATE_POSTED_CHOICES,
  type DatePostedSeconds,
} from '@jobhunter/core/search';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnyFieldApi } from './types';

interface DatePostedSectionProps {
  field: AnyFieldApi;
}

export function DatePostedSection({ field }: DatePostedSectionProps) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const current = field.state.value as DatePostedSeconds;
  const currentChoice = DATE_POSTED_CHOICES.find((c) => c.value === current);
  const currentLabel = (currentChoice?.label ?? 'past 24 hours').toLowerCase();

  return (
    <>
      <CardHeader>
        <CardTitle>Date posted</CardTitle>
        <CardDescription>Maximum job post age</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={isInvalid} orientation="horizontal">
          <Select
            value={current}
            onValueChange={(value: DatePostedSeconds | null) => {
              if (value !== null) field.handleChange(value);
            }}
            items={DATE_POSTED_CHOICES}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {DATE_POSTED_CHOICES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Showing posts from <span className="text-foreground">{currentLabel}</span>.
          </p>
        </Field>
        <FieldError errors={field.state.meta.errors} />
      </CardContent>
    </>
  );
}
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { DATE_POSTED_CHOICES, type DatePostedSeconds } from '@jobhunter/core/search';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Clock } from 'lucide-react';
import type { AnyFieldApi, SectionForm } from './types';

interface DatePostedSectionProps {
  form: SectionForm;
}

function describeFreshness(seconds: DatePostedSeconds): string {
  if (seconds === 86400) return 'the last 1 day';
  if (seconds === 604800) return 'the last 1 week';
  return 'the last 1 month';
}

export function DatePostedSection({ form }: DatePostedSectionProps) {
  return (
    <form.Field name="search.datePosted">
      {(field: AnyFieldApi) => <DatePostedBody field={field} />}
    </form.Field>
  );
}

function DatePostedBody({ field }: { field: AnyFieldApi }) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const current = field.state.value as DatePostedSeconds;
  const currentChoice = DATE_POSTED_CHOICES.find((c) => c.value === current);

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
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Clock />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                Freshness filter set to posts published within{' '}
                {describeFreshness(currentChoice?.value ?? current)}.
              </ItemTitle>
            </ItemContent>
          </Item>
        </Field>
        <FieldError errors={field.state.meta.errors} />
      </CardContent>
    </>
  );
}

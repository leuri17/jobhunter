import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { WORKPLACE_TYPE_CHOICES, type WorkplaceTypeValue } from '@jobhunter/core/search';
import { Building2, Cloud, House } from 'lucide-react';
import { cn } from 'cn';
import type { AnyFieldApi } from './types';

const workplaceIcons: Record<WorkplaceTypeValue, typeof Building2> = {
  '1': Building2,
  '2': Cloud,
  '3': House,
};

interface WorkplaceTypesSectionProps {
  field: AnyFieldApi;
}

export function WorkplaceTypesSection({ field }: WorkplaceTypesSectionProps) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const selected = field.state.value as WorkplaceTypeValue[];

  return (
    <>
      <CardHeader>
        <CardTitle>Workplace types</CardTitle>
        <CardDescription>
          Filter by workplace setting. Standard IDs match upstream job listing parameters.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={isInvalid}>
          <div
            role="group"
            aria-label="Workplace types"
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            {WORKPLACE_TYPE_CHOICES.map((choice) => {
              const isSelected = selected.includes(choice.value);
              const Icon = workplaceIcons[choice.value];
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
                    'flex items-center gap-3 rounded-xl border p-4 text-left transition-colors',
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
                  <span className="text-sm font-medium leading-tight">{choice.label}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <FieldError errors={field.state.meta.errors} />
      </CardContent>
    </>
  );
}
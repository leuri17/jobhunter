import { SENIORITY_LEVELS, type SeniorityLevel } from '@jobhunter/core/profile/schema';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChipListEditor } from './chip-list-editor';
import { OverrideFooter } from './override-footer';
import type { ProfileFormApi } from './profile-form-validator';
import type { DerivedValue } from './derived-types';

const SENIORITY_LABELS: Record<string, string> = {
  intern: 'Intern',
  junior: 'Junior',
  mid: 'Mid-level',
  senior: 'Senior',
  staff: 'Staff',
  principal: 'Principal',
  lead: 'Lead',
  manager: 'Manager',
  director: 'Director',
  executive: 'Executive',
};

export function TargetRolesSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Target role titles &amp; seniority</CardTitle>
        <CardDescription>
          Roles and seniority used to match search results. Extracted values can be overridden.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form.Field name="derived.primaryRoles">
          {(field) => {
            const value = field.state.value as DerivedValue<string[]>;
            const list = value.overrideActive
              ? (value.overrideValue ?? [])
              : [...value.generatedValue];
            const activate = (next: string[]) =>
              field.handleChange({
                ...value,
                overrideActive: true,
                overrideValue: next,
                overriddenAt: new Date().toISOString(),
                effectiveValue: next,
              });
            return (
              <div className="flex flex-col gap-2">
                <ChipListEditor
                  values={list}
                  onChange={activate}
                  addPlaceholder="Type a role title and press Enter…"
                  removeLabel={(role) => `Remove role ${role}`}
                />
                {value.overrideActive && (
                  <OverrideFooter
                    label="Generated"
                    generated={value.generatedValue.join(', ') || '—'}
                    onReset={() =>
                      field.handleChange({
                        ...value,
                        overrideActive: false,
                        overrideValue: null,
                        overriddenAt: null,
                        effectiveValue: value.generatedValue,
                      })
                    }
                  />
                )}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="derived.likelySeniority">
          {(field) => {
            const value = field.state.value as DerivedValue<SeniorityLevel | null>;
            const current = value.overrideActive
              ? (value.overrideValue ?? '')
              : (value.generatedValue ?? '');
            return (
              <div className="flex flex-col gap-2">
                <Field>
                  <Label htmlFor="likely-seniority">Seniority</Label>
                  <Select
                    value={current === '' ? 'auto' : current}
                    onValueChange={(raw) => {
                      const next = raw as SeniorityLevel | 'auto';
                      if (next === 'auto') {
                        field.handleChange({
                          ...value,
                          overrideActive: false,
                          overrideValue: null,
                          overriddenAt: null,
                          effectiveValue: value.generatedValue,
                        });
                        return;
                      }
                      field.handleChange({
                        ...value,
                        overrideActive: true,
                        overrideValue: next,
                        overriddenAt: new Date().toISOString(),
                        effectiveValue: next,
                      });
                    }}
                  >
                    <SelectTrigger id="likely-seniority" className="w-56">
                      <SelectValue placeholder="Auto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto
                        {value.generatedValue !== null
                          ? ` — extracted: ${value.generatedValue}`
                          : ''}
                      </SelectItem>
                      {SENIORITY_LEVELS.map((level) => (
                        <SelectItem key={level} value={level}>
                          {SENIORITY_LABELS[level] ?? level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {value.overrideActive && (
                  <OverrideFooter
                    label="Generated"
                    generated={value.generatedValue ?? '—'}
                    onReset={() =>
                      field.handleChange({
                        ...value,
                        overrideActive: false,
                        overrideValue: null,
                        overriddenAt: null,
                        effectiveValue: value.generatedValue,
                      })
                    }
                  />
                )}
              </div>
            );
          }}
        </form.Field>
      </CardContent>
    </>
  );
}

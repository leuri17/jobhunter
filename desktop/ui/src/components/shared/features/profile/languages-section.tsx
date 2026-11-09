import { useState } from 'react';
import { LANGUAGE_LEVELS } from '@jobhunter/core/profile/schema';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Language, ProfessionalProfile } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import type { ProfileFormApi } from './profile-form-validator';

const LEVEL_LABELS: Record<Exclude<Language['level'], null>, string> = {
  basic: 'Basic',
  conversational: 'Conversational',
  professional: 'Professional',
  fluent: 'Fluent',
  native: 'Native',
};

export function emptyLanguage(): Language {
  return {
    id: crypto.randomUUID(),
    name: '',
    normalizedName: '',
    level: null,
    sourceReferences: [],
  };
}

export function LanguagesSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Languages</CardTitle>
        <CardDescription>Languages extracted from your sources.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Subscribe selector={(s) => s.values}>
          {(values) => <LanguagesSectionBody form={form} profile={values as ProfessionalProfile} />}
        </form.Subscribe>
      </CardContent>
    </>
  );
}

function LanguagesSectionBody({
  form,
  profile,
}: {
  form: ProfileFormApi;
  profile: ProfessionalProfile;
}) {
  const [filter, setFilter] = useState('');
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const query = filter.trim().toLowerCase();
  const visibleIndices = profile.languages
    .map((_, index) => index)
    .filter((index) => {
      if (query === '') {
        return true;
      }
      const language = profile.languages[index];
      if (!language) {
        return false;
      }
      return language.name.toLowerCase().includes(query);
    });
  const visibleCount = visibleIndices.length;

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter languages…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {visibleCount === 1 ? '1 language' : `${visibleCount} languages`}
        </span>
      </div>

      <form.Field name="languages" mode="array">
        {(field) => (
          <div className="flex flex-col gap-3">
            {profile.languages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No languages yet. Add an entry or run extraction.
              </p>
            ) : (
              visibleIndices.map((actualIndex) => {
                const languageId = profile.languages[actualIndex]?.id ?? String(actualIndex);
                return (
                  <form.Field key={languageId} name={`languages[${actualIndex}]`}>
                    {(entry) => {
                      const language = entry.state.value;
                      return (
                        <ArrayEntryRow
                          title={language.name || 'New language'}
                          meta={language.level ?? '—'}
                          hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
                          onRemove={() => field.removeValue(actualIndex)}
                          removeLabel={`Remove ${language.name || 'language'}`}
                          defaultOpen={language.id === lastAddedId}
                        >
                          <form.Field name={`languages[${actualIndex}].name`}>
                            {(leaf) => (
                              <div className="sm:col-span-6">
                                <Field>
                                  <Label htmlFor={leaf.name}>Language</Label>
                                  <Input
                                    id={leaf.name}
                                    value={leaf.state.value}
                                    autoFocus={language.id === lastAddedId}
                                    onChange={(e) => leaf.handleChange(e.target.value)}
                                    onBlur={leaf.handleBlur}
                                  />
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>

                          <form.Field name={`languages[${actualIndex}].level`}>
                            {(leaf) => (
                              <div className="sm:col-span-6">
                                <Field>
                                  <Label htmlFor={leaf.name}>Level</Label>
                                  <Select
                                    value={leaf.state.value ?? ''}
                                    onValueChange={(value) =>
                                      leaf.handleChange(
                                        value === '' ? null : (value as Language['level']),
                                      )
                                    }
                                  >
                                    <SelectTrigger id={leaf.name} className="w-full">
                                      <SelectValue placeholder="Level" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="">—</SelectItem>
                                      {LANGUAGE_LEVELS.map((level) => (
                                        <SelectItem key={level} value={level}>
                                          {LEVEL_LABELS[level]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>
                        </ArrayEntryRow>
                      );
                    }}
                  </form.Field>
                );
              })
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => {
                const next = emptyLanguage();
                field.pushValue(next);
                setLastAddedId(next.id);
              }}
            >
              Add language
            </Button>
          </div>
        )}
      </form.Field>
    </>
  );
}

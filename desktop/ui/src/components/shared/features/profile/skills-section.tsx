import { useState } from 'react';
import { SKILL_PROFICIENCIES } from '@jobhunter/core/profile/schema';
import { Badge } from '@/components/ui/badge';
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
import type { ProfessionalProfile, Skill } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import { SKILL_CATEGORIES, categoryLabel } from './category-labels';
import type { ProfileFormApi } from './profile-form-validator';

const PROFICIENCY_LABELS: Record<Exclude<Skill['proficiency'], null>, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  expert: 'Expert',
};

export function emptySkill(): Skill {
  return {
    id: crypto.randomUUID(),
    name: '',
    normalizedName: '',
    category: 'other',
    proficiency: null,
    yearsOfExperience: null,
    lastUsedAt: null,
    evidence: [],
  };
}

export function SkillsSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          Every skill reconciled from your sources, with category and proficiency.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Subscribe selector={(s) => s.values}>
          {(values) => <SkillsSectionBody form={form} profile={values as ProfessionalProfile} />}
        </form.Subscribe>
      </CardContent>
    </>
  );
}

function SkillsSectionBody({
  form,
  profile,
}: {
  form: ProfileFormApi;
  profile: ProfessionalProfile;
}) {
  const [filter, setFilter] = useState('');
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const query = filter.trim().toLowerCase();
  const visibleIndices = profile.skills
    .map((_, index) => index)
    .filter((index) => {
      if (query === '') {
        return true;
      }
      const skill = profile.skills[index];
      if (!skill) {
        return false;
      }
      return (
        skill.name.toLowerCase().includes(query) ||
        categoryLabel(skill.category).toLowerCase().includes(query)
      );
    });
  const visibleCount = visibleIndices.length;

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter skills…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {visibleCount === 1 ? '1 skill' : `${visibleCount} skills`}
        </span>
      </div>

      <form.Field name="skills" mode="array">
        {(field) => (
          <div className="flex flex-col gap-3">
            {profile.skills.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No skills yet. Add an entry or run extraction.
              </p>
            ) : (
              visibleIndices.map((actualIndex) => {
                const skillId = profile.skills[actualIndex]?.id ?? String(actualIndex);
                return (
                  <form.Field key={skillId} name={`skills[${actualIndex}]`}>
                    {(entry) => {
                      const skill = entry.state.value;
                      return (
                        <ArrayEntryRow
                          title={skill.name || 'New skill'}
                          badges={
                            <Badge variant="outline" className="text-[10px]">
                              {categoryLabel(skill.category)}
                            </Badge>
                          }
                          meta={`${categoryLabel(skill.category)} · ${skill.proficiency ?? '—'} · ${skill.yearsOfExperience ?? '—'} yrs · last used ${skill.lastUsedAt ?? '—'}`}
                          hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
                          onRemove={() => field.removeValue(actualIndex)}
                          removeLabel={`Remove ${skill.name || 'skill'}`}
                          defaultOpen={skill.id === lastAddedId}
                        >
                          <form.Field name={`skills[${actualIndex}].name`}>
                            {(leaf) => (
                              <div className="sm:col-span-3">
                                <Field>
                                  <Label htmlFor={leaf.name}>Name</Label>
                                  <Input
                                    id={leaf.name}
                                    value={leaf.state.value}
                                    autoFocus={skill.id === lastAddedId}
                                    onChange={(e) => leaf.handleChange(e.target.value)}
                                    onBlur={leaf.handleBlur}
                                  />
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>

                          <form.Field name={`skills[${actualIndex}].category`}>
                            {(leaf) => (
                              <div className="sm:col-span-3">
                                <Field>
                                  <Label htmlFor={leaf.name}>Category</Label>
                                  <Select
                                    value={leaf.state.value ?? 'other'}
                                    onValueChange={(value) =>
                                      leaf.handleChange(value as Skill['category'])
                                    }
                                  >
                                    <SelectTrigger id={leaf.name} className="w-full">
                                      <SelectValue placeholder="Category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SKILL_CATEGORIES.map((category) => (
                                        <SelectItem key={category} value={category}>
                                          {categoryLabel(category)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>

                          <form.Field name={`skills[${actualIndex}].proficiency`}>
                            {(leaf) => (
                              <div className="sm:col-span-2">
                                <Field>
                                  <Label htmlFor={leaf.name}>Proficiency</Label>
                                  <Select
                                    value={leaf.state.value ?? ''}
                                    onValueChange={(value) =>
                                      leaf.handleChange(
                                        value === '' ? null : (value as Skill['proficiency']),
                                      )
                                    }
                                  >
                                    <SelectTrigger id={leaf.name} className="w-full">
                                      <SelectValue placeholder="Proficiency" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="">—</SelectItem>
                                      {SKILL_PROFICIENCIES.map((level) => (
                                        <SelectItem key={level} value={level}>
                                          {PROFICIENCY_LABELS[level]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>

                          <form.Field name={`skills[${actualIndex}].yearsOfExperience`}>
                            {(leaf) => (
                              <div className="sm:col-span-2">
                                <Field>
                                  <Label htmlFor={leaf.name}>Years of experience</Label>
                                  <Input
                                    id={leaf.name}
                                    type="number"
                                    value={leaf.state.value ?? ''}
                                    onChange={(e) =>
                                      leaf.handleChange(
                                        e.target.value === '' ? null : Number(e.target.value),
                                      )
                                    }
                                    onBlur={leaf.handleBlur}
                                  />
                                  <FieldError errors={leaf.state.meta.errors} />
                                </Field>
                              </div>
                            )}
                          </form.Field>

                          <form.Field name={`skills[${actualIndex}].lastUsedAt`}>
                            {(leaf) => (
                              <div className="sm:col-span-2">
                                <Field>
                                  <Label htmlFor={leaf.name}>Last used</Label>
                                  <Input
                                    id={leaf.name}
                                    placeholder="2025-11"
                                    value={leaf.state.value ?? ''}
                                    onChange={(e) =>
                                      leaf.handleChange(
                                        e.target.value === '' ? null : e.target.value,
                                      )
                                    }
                                    onBlur={leaf.handleBlur}
                                  />
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
                const next = emptySkill();
                field.pushValue(next);
                setLastAddedId(next.id);
              }}
            >
              Add skill
            </Button>
          </div>
        )}
      </form.Field>
    </>
  );
}

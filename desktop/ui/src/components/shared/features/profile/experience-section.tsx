import type { ProfileFormApi } from './profile-form-validator';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { WorkExperience } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import { ChipListEditor } from './chip-list-editor';

export function emptyExperience(): WorkExperience {
  return {
    id: crypto.randomUUID(),
    company: '',
    title: '',
    location: null,
    startDate: null,
    endDate: null,
    isCurrent: false,
    summary: null,
    responsibilities: [],
    achievements: [],
    technologies: [],
    domains: [],
    sourceReferences: [],
  };
}

export function ExperienceSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Work experience</CardTitle>
        <CardDescription>
          Positions extracted from your sources, editable before saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Field name="experience" mode="array">
          {(field) => (
            <>
              {field.state.value.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No work experience yet. Add an entry or run extraction.
                </p>
              ) : null}
              {field.state.value.map((experience, i) => (
                <ExperienceEntry
                  key={experience.id}
                  form={form}
                  index={i}
                  onRemove={() => field.removeValue(i)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => field.pushValue(emptyExperience())}
              >
                Add experience
              </Button>
            </>
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

function ExperienceEntry({
  form,
  index,
  onRemove,
}: {
  form: ProfileFormApi;
  index: number;
  onRemove: () => void;
}) {
  return (
    <form.Field name={`experience[${index}]`}>
      {(entry) => {
        const value = entry.state.value;
        const meta =
          `${value.startDate ?? '—'} — ${value.isCurrent ? 'Present' : (value.endDate ?? '—')}` +
          (value.location ? ` · ${value.location}` : '') +
          (value.technologies.length > 0 ? ` · ${value.technologies.slice(0, 3).join(', ')}` : '');
        return (
          <ArrayEntryRow
            title={value.company || 'New experience'}
            meta={meta}
            hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
            defaultOpen={value.company === ''}
            onRemove={onRemove}
            removeLabel={`Remove ${value.company || 'experience'}`}
          >
            <form.Field name={`experience[${index}].company`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>Company</Label>
                    <Input
                      id={leaf.name}
                      value={leaf.state.value}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].title`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>Job title</Label>
                    <Input
                      id={leaf.name}
                      value={leaf.state.value}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].location`}>
              {(leaf) => (
                <div className="sm:col-span-2">
                  <Field>
                    <Label htmlFor={leaf.name}>Location</Label>
                    <Input
                      id={leaf.name}
                      value={leaf.state.value ?? ''}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].startDate`}>
              {(leaf) => (
                <div className="sm:col-span-2">
                  <Field>
                    <Label htmlFor={leaf.name}>Start date</Label>
                    <Input
                      id={leaf.name}
                      placeholder="2021-03"
                      value={leaf.state.value ?? ''}
                      onChange={(e) =>
                        leaf.handleChange(e.target.value === '' ? null : e.target.value)
                      }
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].endDate`}>
              {(leaf) => (
                <div className="sm:col-span-1">
                  <Field>
                    <Label htmlFor={leaf.name}>End date</Label>
                    <Input
                      id={leaf.name}
                      value={leaf.state.value ?? ''}
                      disabled={entry.state.value.isCurrent}
                      onChange={(e) =>
                        leaf.handleChange(e.target.value === '' ? null : e.target.value)
                      }
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].isCurrent`}>
              {(leaf) => (
                <div className="sm:col-span-1">
                  <Field>
                    <Label htmlFor={leaf.name}>Current role</Label>
                    <Checkbox
                      id={leaf.name}
                      checked={leaf.state.value}
                      onCheckedChange={(checked: boolean) =>
                        entry.handleChange({
                          ...entry.state.value,
                          isCurrent: checked,
                          endDate: checked ? null : entry.state.value.endDate,
                        })
                      }
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].summary`}>
              {(leaf) => (
                <div className="sm:col-span-6">
                  <Field>
                    <Label htmlFor={leaf.name}>Summary</Label>
                    <Textarea
                      id={leaf.name}
                      rows={3}
                      value={leaf.state.value ?? ''}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].responsibilities`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <ChipListEditor
                    values={leaf.state.value}
                    onChange={leaf.handleChange}
                    addPlaceholder="Add a responsibility…"
                    removeLabel={(chip) => `Remove ${chip}`}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].achievements`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <ChipListEditor
                    values={leaf.state.value}
                    onChange={leaf.handleChange}
                    addPlaceholder="Add an achievement…"
                    removeLabel={(chip) => `Remove ${chip}`}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].technologies`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <ChipListEditor
                    values={leaf.state.value}
                    onChange={leaf.handleChange}
                    addPlaceholder="Add a technology…"
                    removeLabel={(chip) => `Remove ${chip}`}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name={`experience[${index}].domains`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <ChipListEditor
                    values={leaf.state.value}
                    onChange={leaf.handleChange}
                    addPlaceholder="Add a domain…"
                    removeLabel={(chip) => `Remove ${chip}`}
                  />
                </div>
              )}
            </form.Field>
          </ArrayEntryRow>
        );
      }}
    </form.Field>
  );
}

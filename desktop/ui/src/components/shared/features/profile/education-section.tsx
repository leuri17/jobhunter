import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Education } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import type { ProfileFormApi } from './profile-form-validator';

export function emptyEducation(): Education {
  return {
    id: crypto.randomUUID(),
    institution: '',
    qualification: null,
    fieldOfStudy: null,
    startDate: null,
    endDate: null,
    location: null,
    sourceReferences: [],
  };
}

export function EducationSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Education</CardTitle>
        <CardDescription>Degrees and studies extracted from your sources.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Field name="education" mode="array">
          {(field) => (
            <>
              {field.state.value.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No education entries yet. Add an entry or run extraction.
                </p>
              )}
              {field.state.value.map((education, i) => (
                <form.Field key={education.id} name={`education[${i}]`}>
                  {(entry) => {
                    const { institution, location, startDate, endDate } = entry.state.value;
                    return (
                      <ArrayEntryRow
                        title={institution || 'New education'}
                        meta={`${startDate ?? '—'} — ${endDate ?? '—'}${location ? ` · ${location}` : ''}`}
                        hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
                        onRemove={() => field.removeValue(i)}
                        removeLabel={`Remove ${institution || 'education'}`}
                        defaultOpen={!institution}
                      >
                        <form.Field name={`education[${i}].institution`}>
                          {(leaf) => (
                            <div className="sm:col-span-4">
                              <Field>
                                <Label htmlFor={leaf.name}>Institution</Label>
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
                        <form.Field name={`education[${i}].qualification`}>
                          {(leaf) => (
                            <div className="sm:col-span-4">
                              <Field>
                                <Label htmlFor={leaf.name}>Qualification</Label>
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
                        <form.Field name={`education[${i}].fieldOfStudy`}>
                          {(leaf) => (
                            <div className="sm:col-span-4">
                              <Field>
                                <Label htmlFor={leaf.name}>Field of study</Label>
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
                        <form.Field name={`education[${i}].startDate`}>
                          {(leaf) => (
                            <div className="sm:col-span-2">
                              <Field>
                                <Label htmlFor={leaf.name}>Start date</Label>
                                <Input
                                  id={leaf.name}
                                  placeholder="2012"
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
                        <form.Field name={`education[${i}].endDate`}>
                          {(leaf) => (
                            <div className="sm:col-span-2">
                              <Field>
                                <Label htmlFor={leaf.name}>End date</Label>
                                <Input
                                  id={leaf.name}
                                  placeholder="2016"
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
                        <form.Field name={`education[${i}].location`}>
                          {(leaf) => (
                            <div className="sm:col-span-4">
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
                      </ArrayEntryRow>
                    );
                  }}
                </form.Field>
              ))}
              <Button
                variant="outline"
                className="w-full border-dashed"
                onClick={() => field.pushValue(emptyEducation())}
              >
                Add education
              </Button>
            </>
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

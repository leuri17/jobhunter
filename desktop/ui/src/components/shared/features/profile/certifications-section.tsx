import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Certification } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import type { ProfileFormApi } from './profile-form-validator';

export function emptyCertification(): Certification {
  return {
    id: crypto.randomUUID(),
    name: '',
    issuer: null,
    issuedAt: null,
    expiresAt: null,
    credentialId: null,
    credentialUrl: null,
    sourceReferences: [],
  };
}

export function CertificationsSection({ form }: { form: ProfileFormApi }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <>
      <CardHeader>
        <CardTitle>Certifications</CardTitle>
        <CardDescription>Certificates extracted from your sources.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Field name="certifications" mode="array">
          {(field) => (
            <>
              {field.state.value.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No certifications yet. Add an entry or run extraction.
                </p>
              )}
              {field.state.value.map((certification, i) => (
                <form.Field key={certification.id} name={`certifications[${i}]`}>
                  {(entry) => {
                    const { name, issuer, issuedAt } = entry.state.value;
                    return (
                      <ArrayEntryRow
                        title={name || 'New certification'}
                        meta={`issued ${issuedAt ?? '—'}${issuer ? ` · ${issuer}` : ''}`}
                        hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
                        onRemove={() => field.removeValue(i)}
                        removeLabel={`Remove ${name || 'certification'}`}
                        defaultOpen={!name}
                      >
                        <form.Field name={`certifications[${i}].name`}>
                          {(leaf) => (
                            <div className="sm:col-span-3">
                              <Field>
                                <Label htmlFor={leaf.name}>Name</Label>
                                <Input
                                  id={leaf.name}
                                  value={leaf.state.value ?? ''}
                                  autoFocus={certification.id === focusId}
                                  onChange={(e) => leaf.handleChange(e.target.value)}
                                  onBlur={leaf.handleBlur}
                                />
                                <FieldError errors={leaf.state.meta.errors} />
                              </Field>
                            </div>
                          )}
                        </form.Field>
                        <form.Field name={`certifications[${i}].issuer`}>
                          {(leaf) => (
                            <div className="sm:col-span-3">
                              <Field>
                                <Label htmlFor={leaf.name}>Issuer</Label>
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
                        <form.Field name={`certifications[${i}].issuedAt`}>
                          {(leaf) => (
                            <div className="sm:col-span-2">
                              <Field>
                                <Label htmlFor={leaf.name}>Issued at</Label>
                                <Input
                                  id={leaf.name}
                                  placeholder="2021-05"
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
                        <form.Field name={`certifications[${i}].expiresAt`}>
                          {(leaf) => (
                            <div className="sm:col-span-2">
                              <Field>
                                <Label htmlFor={leaf.name}>Expires at</Label>
                                <Input
                                  id={leaf.name}
                                  placeholder="2025-05"
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
                        <form.Field name={`certifications[${i}].credentialId`}>
                          {(leaf) => (
                            <div className="sm:col-span-4">
                              <Field>
                                <Label htmlFor={leaf.name}>Credential ID</Label>
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
                        <form.Field name={`certifications[${i}].credentialUrl`}>
                          {(leaf) => (
                            <div className="sm:col-span-6">
                              <Field>
                                <Label htmlFor={leaf.name}>Credential URL</Label>
                                <Input
                                  id={leaf.name}
                                  type="url"
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
                onClick={() => {
                  const entry = emptyCertification();
                  field.pushValue(entry);
                  setFocusId(entry.id);
                }}
              >
                Add certification
              </Button>
            </>
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

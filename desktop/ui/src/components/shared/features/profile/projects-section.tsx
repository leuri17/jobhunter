import { useState } from 'react';
import type { ProfileFormApi } from './profile-form-validator';
import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/lib/types';
import { ArrayEntryRow } from './array-entry-row';
import { ChipListEditor } from './chip-list-editor';

export function emptyProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: null,
    role: null,
    startDate: null,
    endDate: null,
    technologies: [],
    achievements: [],
    url: null,
    sourceReferences: [],
  };
}

export function ProjectsSection({ form }: { form: ProfileFormApi }) {
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>Side work and notable projects.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form.Field name="projects" mode="array">
          {(field) => (
            <>
              {field.state.value.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No projects yet. Add an entry or run extraction.
                </p>
              ) : null}
              {field.state.value.map((project, i) => (
                <ProjectEntry
                  key={project.id}
                  form={form}
                  index={i}
                  autoFocus={project.id === focusId}
                  onRemove={() => field.removeValue(i)}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed"
                onClick={() => {
                  const entry = emptyProject();
                  field.pushValue(entry);
                  setFocusId(entry.id);
                }}
              >
                Add project
              </Button>
            </>
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

function ProjectEntry({
  form,
  index,
  autoFocus,
  onRemove,
}: {
  form: ProfileFormApi;
  index: number;
  autoFocus?: boolean;
  onRemove: () => void;
}) {
  return (
    <form.Field name={`projects[${index}]`}>
      {(entry) => {
        const value = entry.state.value;
        const meta =
          `${value.startDate ?? '—'} — ${value.endDate ?? '—'}` +
          (value.role ? ` · ${value.role}` : '') +
          (value.url ? ` · ${value.url.replace(/^https?:\/\//, '')}` : '');
        return (
          <ArrayEntryRow
            title={value.name || 'New project'}
            meta={meta}
            hasError={entry.state.meta.isTouched && !entry.state.meta.isValid}
            defaultOpen={value.name === ''}
            onRemove={onRemove}
            removeLabel={`Remove ${value.name || 'project'}`}
          >
            <form.Field name={`projects[${index}].name`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>Name</Label>
                    <Input
                      id={leaf.name}
                      value={leaf.state.value}
                      autoFocus={autoFocus}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`projects[${index}].role`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>Role</Label>
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
            <form.Field name={`projects[${index}].url`}>
              {(leaf) => (
                <div className="sm:col-span-6">
                  <Field>
                    <Label htmlFor={leaf.name}>URL</Label>
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
            <form.Field name={`projects[${index}].description`}>
              {(leaf) => (
                <div className="sm:col-span-6">
                  <Field>
                    <Label htmlFor={leaf.name}>Description</Label>
                    <Textarea
                      id={leaf.name}
                      rows={2}
                      value={leaf.state.value ?? ''}
                      onChange={(e) => leaf.handleChange(e.target.value)}
                      onBlur={leaf.handleBlur}
                    />
                    <FieldError errors={leaf.state.meta.errors} />
                  </Field>
                </div>
              )}
            </form.Field>
            <form.Field name={`projects[${index}].startDate`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>Start date</Label>
                    <Input
                      id={leaf.name}
                      placeholder="2021-01"
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
            <form.Field name={`projects[${index}].endDate`}>
              {(leaf) => (
                <div className="sm:col-span-3">
                  <Field>
                    <Label htmlFor={leaf.name}>End date</Label>
                    <Input
                      id={leaf.name}
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
            <form.Field name={`projects[${index}].technologies`}>
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
            <form.Field name={`projects[${index}].achievements`}>
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
          </ArrayEntryRow>
        );
      }}
    </form.Field>
  );
}

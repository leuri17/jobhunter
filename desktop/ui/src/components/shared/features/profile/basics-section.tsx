import type { ProfileFormApi } from './profile-form-validator';
import { CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function BasicsSection({ form }: { form: ProfileFormApi }) {
  return (
    <>
      <CardHeader>
        <CardTitle>Candidate &amp; summary</CardTitle>
        <CardDescription>Name and contact details used across generated documents.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <form.Field name="basics.fullName">
          {(field) => (
            <Field>
              <Label htmlFor={field.name}>Full name</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="basics.email">
          {(field) => (
            <Field>
              <Label htmlFor={field.name}>Email</Label>
              <Input
                id={field.name}
                type="email"
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="basics.phone">
          {(field) => (
            <Field>
              <Label htmlFor={field.name}>Phone</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="basics.currentLocation">
          {(field) => (
            <Field>
              <Label htmlFor={field.name}>Current location</Label>
              <Input
                id={field.name}
                value={field.state.value ?? ''}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="basics.totalYearsOfExperience">
          {(field) => (
            <Field>
              <Label htmlFor={field.name}>Total years of experience</Label>
              <Input
                id={field.name}
                type="number"
                step="0.1"
                value={field.state.value ?? ''}
                onChange={(e) =>
                  field.handleChange(e.target.value === '' ? null : Number(e.target.value))
                }
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="basics.headline">
          {(field) => (
            <div className="sm:col-span-2">
              <Field>
                <Label htmlFor={field.name}>Headline</Label>
                <Input
                  id={field.name}
                  value={field.state.value ?? ''}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            </div>
          )}
        </form.Field>
        <form.Field name="basics.professionalSummary">
          {(field) => (
            <div className="sm:col-span-2">
              <Field>
                <Label htmlFor={field.name}>Professional summary</Label>
                <Textarea
                  id={field.name}
                  rows={4}
                  value={field.state.value ?? ''}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            </div>
          )}
        </form.Field>
      </CardContent>
    </>
  );
}

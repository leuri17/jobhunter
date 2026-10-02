import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Trash } from 'lucide-react';
import LocationPicker from './location-picker';
import type { AnyFieldApi } from './types';

interface LocationsSectionProps {
  field: AnyFieldApi;
}

interface LocationEntry {
  name: string;
  geoId: string;
}

export function LocationsSection({ field }: LocationsSectionProps) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const values = field.state.value as LocationEntry[];

  return (
    <>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
        <CardDescription>
          LinkedIn locations to search. At least one is required for the pipeline to run.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field data-invalid={isInvalid}>
          {values.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No locations yet. Search and add one below.
            </p>
          ) : (
            <Table>
              <TableBody>
                {values.map((loc, i) => (
                  <TableRow key={i} className="items-center">
                    <TableCell className="flex flex-col">
                      <span>{loc.name}</span>
                      <span className="text-xs text-muted-foreground">{loc.geoId}</span>
                    </TableCell>
                    <TableCell className="w-12 text-right">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Remove ${loc.geoId}`}
                        onClick={() => field.removeValue(i)}
                      >
                        <Trash />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Field>
        <FieldError errors={field.state.meta.errors} />

        <LocationPicker
          onSelect={(loc) => {
            const alreadyAdded = values.some((l) => l.geoId === loc.geoId);
            if (!alreadyAdded) field.pushValue(loc);
          }}
        />
      </CardContent>
    </>
  );
}
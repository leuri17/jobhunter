import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import type { GeoHit } from '@/lib/types';
import { OperationalConfigSchema } from '@jobhunter/core/config/schemas';
import { useEffect, useMemo, useState } from 'react';
import z from 'zod';

interface LocationPickerProps {
  onSelect: (
    location: z.infer<typeof OperationalConfigSchema.shape.search.shape.locations.element>,
  ) => void;
}

export default function LocationPicker({ onSelect }: LocationPickerProps) {
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const q = search.trim();
    if (q.length === 0) {
      setHits([]);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.geoTypeahead(q);
        if (controller.signal.aborted) return;
        setHits([...res.hits]);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setHits([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search]);

  const items = useMemo(() => hits, [hits]);

  return (
    <Combobox<GeoHit>
      items={items}
      itemToStringValue={(item) => item.displayName}
      inputValue={search}
      onInputValueChange={setSearch}
      open={search.length > 0}
      onValueChange={(value, ev) => {
        ev.cancel();
        if (value === null) return;
        onSelect({ name: value.displayName, geoId: value.id });
        setSearch('');
        // setHits([]);
        // value = null;
      }}
    >
      <ComboboxInput placeholder="Add a location…" />
      <ComboboxContent>
        {isLoading ? (
          <div className="flex min-w-full justify-center p-4">
            <Spinner />
          </div>
        ) : (
          <ComboboxList>
            {(hit) => (
              <ComboboxItem key={hit.id} value={hit}>
                {hit.displayName}
              </ComboboxItem>
            )}
          </ComboboxList>
        )}
        {!isLoading && <ComboboxEmpty>No locations found.</ComboboxEmpty>}
      </ComboboxContent>
    </Combobox>
  );
}

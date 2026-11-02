import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export interface ChipListEditorProps {
  values: string[];
  onChange: (next: string[]) => void;
  addPlaceholder: string;
  removeLabel: (value: string) => string;
}

export function ChipListEditor({
  values,
  onChange,
  addPlaceholder,
  removeLabel,
}: ChipListEditorProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== '' && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="outline" className="rounded-full px-2.5 py-1 text-xs">
              {value}
              <button
                type="button"
                aria-label={removeLabel(value)}
                className="ml-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                ✕
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder={addPlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

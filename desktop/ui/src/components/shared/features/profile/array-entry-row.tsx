import { useState, type ReactNode } from 'react';
import { ChevronDown, Trash } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

export interface ArrayEntryRowProps {
  title: string;
  meta?: string;
  badges?: ReactNode;
  hasError?: boolean;
  onRemove: () => void;
  removeLabel: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function ArrayEntryRow({
  title,
  meta,
  badges,
  hasError,
  onRemove,
  removeLabel,
  defaultOpen = false,
  children,
}: ArrayEntryRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border bg-card/50 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
            {hasError && (
              <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
            )}
            <span className="truncate text-sm font-medium">{title}</span>
            {badges}
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            aria-label={removeLabel}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash />
          </Button>
        </div>
        {meta && <p className="mt-0.5 pl-6 font-mono text-[11px] text-muted-foreground">{meta}</p>}
        <CollapsibleContent>
          <div className="grid gap-4 border-t pt-4 sm:grid-cols-6">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

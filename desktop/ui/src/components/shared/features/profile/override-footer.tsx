import { Button } from '@/components/ui/button';

export interface OverrideFooterProps {
  label: string;
  generated: string;
  onReset: () => void;
}

export function OverrideFooter({ label, generated, onReset }: OverrideFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        {label}: {generated}
      </span>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onReset}>
        Reset to generated
      </Button>
    </div>
  );
}

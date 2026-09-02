import { useEffect, useRef } from 'react';

export interface LogPaneProps {
  readonly lines: readonly string[];
  readonly followTail?: boolean;
}

export function LogPane({ lines, followTail = true }: LogPaneProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (followTail && ref.current !== null) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines, followTail]);

  return (
    <div
      ref={ref}
      className="h-64 overflow-auto rounded border border-border bg-zinc-900 p-3 font-mono text-xs leading-relaxed"
    >
      {lines.length === 0 ? (
        <span className="text-zinc-500">(no output yet)</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
        ))
      )}
    </div>
  );
}

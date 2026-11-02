export const SOURCE_EXTENSIONS = ['pdf', 'md', 'markdown', 'txt'] as const;

export interface PickedPathsValidation {
  readonly accepted: string[];
  readonly rejected: readonly { path: string; reason: 'type' }[];
  readonly skippedByCount: string[];
}

export function validatePickedPaths(paths: string[]): PickedPathsValidation {
  const allowed = paths.filter((path) =>
    SOURCE_EXTENSIONS.includes(extensionOf(path) as (typeof SOURCE_EXTENSIONS)[number]),
  );
  return {
    accepted: allowed.slice(0, 2),
    rejected: paths
      .filter(
        (path) =>
          !SOURCE_EXTENSIONS.includes(extensionOf(path) as (typeof SOURCE_EXTENSIONS)[number]),
      )
      .map((path) => ({ path, reason: 'type' as const })),
    skippedByCount: allowed.slice(2),
  };
}

export function mimeForPath(path: string): 'application/pdf' | 'text/markdown' | 'text/plain' {
  switch (extensionOf(path)) {
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    default:
      return 'text/markdown';
  }
}

export function isTauriWebview(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function extensionOf(path: string): string {
  const clean = path.split(/[\\/]/).pop() ?? path;
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

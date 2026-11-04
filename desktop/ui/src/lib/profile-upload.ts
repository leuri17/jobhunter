export const SOURCE_EXTENSIONS = ['pdf', 'md', 'markdown', 'txt'] as const;

export const MAX_PROFILE_SOURCES = 2;

export interface PickedPathsValidation {
  readonly accepted: string[];
  readonly rejected: readonly { path: string; reason: 'type' }[];
  readonly overCapacity: boolean;
}

export function validatePickedPaths(
  paths: string[],
  remainingSlots: number,
): PickedPathsValidation {
  const allowed = paths.filter((path) =>
    SOURCE_EXTENSIONS.includes(extensionOf(path) as (typeof SOURCE_EXTENSIONS)[number]),
  );
  const overCapacity = allowed.length > remainingSlots;
  return {
    accepted: overCapacity ? [] : allowed,
    rejected: paths
      .filter(
        (path) =>
          !SOURCE_EXTENSIONS.includes(extensionOf(path) as (typeof SOURCE_EXTENSIONS)[number]),
      )
      .map((path) => ({ path, reason: 'type' as const })),
    overCapacity,
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

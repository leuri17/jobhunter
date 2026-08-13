const WHITESPACE_PATTERN = /\s+/g;

export function normalizeQuery(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, ' ');
}

export function isNonEmptyQuery(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function dedupeKey(value: string): string {
  return normalizeQuery(value).toLocaleLowerCase();
}

export function dedupeQueries(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (!isNonEmptyQuery(raw)) continue;
    const normalized = normalizeQuery(raw);
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function normalizeQueries(values: readonly string[]): readonly string[] {
  return dedupeQueries(values);
}

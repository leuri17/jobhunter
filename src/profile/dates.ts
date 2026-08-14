import { YearMonthSchema } from './schema.js';

/**
 * Year-month validation and duration math helpers (SPEC.md §14.3).
 *
 * Inputs to this module are expected to be `YearMonthSchema`-compliant strings
 * (`"YYYY"` or `"YYYY-MM"`); impossible months (`00`, `13+`) are rejected.
 */

export function parseYearMonth(value: string): { year: number; month: number | null } {
  const validated = YearMonthSchema.parse(value);
  const dashIndex = validated.indexOf('-');
  const yearPart = dashIndex === -1 ? validated : validated.slice(0, dashIndex);
  const year = Number.parseInt(yearPart, 10);
  if (dashIndex === -1) {
    return { year, month: null };
  }
  const monthPart = validated.slice(dashIndex + 1);
  const month = Number.parseInt(monthPart, 10);
  return { year, month };
}

export function isValidYearMonth(value: string): boolean {
  return YearMonthSchema.safeParse(value).success;
}

export function calculateDurationMonths(
  start: string,
  end: string | null,
  isCurrent: boolean,
  now?: Date,
): number | null {
  if (end === null && !isCurrent) {
    return null;
  }

  const startParsed = parseYearMonth(start);
  // When the start month is absent, treat it as 0 for arithmetic so the whole
  // year counts (e.g. "2020" through August 2026 = 6 years 8 months = 80).
  const startTotal = startParsed.year * 12 + (startParsed.month ?? 0);

  let endTotal: number;
  if (end !== null) {
    const endParsed = parseYearMonth(end);
    endTotal = endParsed.year * 12 + (endParsed.month ?? 0);
  } else {
    const nowDate = now ?? new Date();
    const endYear = nowDate.getUTCFullYear();
    const endMonth = nowDate.getUTCMonth() + 1; // 1-indexed month
    endTotal = endYear * 12 + endMonth;
  }

  if (endTotal < startTotal) {
    return null;
  }
  return endTotal - startTotal;
}

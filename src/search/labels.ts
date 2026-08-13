import { z } from 'zod';

export type DatePostedSeconds = 86400 | 604800 | 2592000;
export type WorkplaceTypeValue = '1' | '2' | '3';

export interface LabeledChoice<V extends string | number> {
  readonly label: string;
  readonly value: V;
}

export const DATE_POSTED_VALUES = [86400, 604800, 2592000] as const;
export const DEFAULT_DATE_POSTED: DatePostedSeconds = 86400;

export const DATE_POSTED_CHOICES: readonly LabeledChoice<DatePostedSeconds>[] = [
  { label: 'Past 24 hours', value: 86400 },
  { label: 'Past week', value: 604800 },
  { label: 'Past month', value: 2592000 },
];

export function DATE_POSTED_F_TPR(value: DatePostedSeconds): string {
  return `r${value}`;
}

export const WORKPLACE_TYPE_VALUES = ['1', '2', '3'] as const;
export const DEFAULT_WORKPLACE_TYPES: readonly WorkplaceTypeValue[] = ['1', '2', '3'];

export const WORKPLACE_TYPE_CHOICES: readonly LabeledChoice<WorkplaceTypeValue>[] = [
  { label: 'On-site', value: '1' },
  { label: 'Remote', value: '2' },
  { label: 'Hybrid', value: '3' },
];

export const WORKPLACE_TYPE_LABELS: Readonly<Record<WorkplaceTypeValue, string>> = {
  '1': 'On-site',
  '2': 'Remote',
  '3': 'Hybrid',
};

export const DatePostedSecondsSchema = z.union([
  z.literal(86400),
  z.literal(604800),
  z.literal(2592000),
]);

export const WorkplaceTypeSchema = z.enum(['1', '2', '3']);

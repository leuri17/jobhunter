import { z } from 'zod';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface LabeledChoice<V extends string | number> {
  readonly label: string;
  readonly value: V;
}

export const REASONING_EFFORT_VALUES = ['low', 'medium', 'high'] as const;

export const REASONING_EFFORT_CHOICES: readonly LabeledChoice<ReasoningEffort>[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

export const ReasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);

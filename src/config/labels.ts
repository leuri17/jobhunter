import { z } from 'zod';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

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

export const LOG_LEVEL_VALUES = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

export const LOG_LEVEL_CHOICES: readonly LabeledChoice<LogLevel>[] = [
  { label: 'Trace', value: 'trace' },
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
  { label: 'Fatal', value: 'fatal' },
  { label: 'Silent', value: 'silent' },
];

export const LogLevelSchema = z.enum(LOG_LEVEL_VALUES);

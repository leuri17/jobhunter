import { createDefaultOpenAIClient, type OpenAIClient } from '@jobhunter/core/profile';

export function resolveOpenAiClientOrNull(): OpenAIClient | null {
  const key = process.env['OPENAI_API_KEY'];
  if (typeof key !== 'string' || key.length === 0) return null;
  return createDefaultOpenAIClient({ apiKey: key });
}

// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { useForm } from '@tanstack/react-form';
import { DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';

import { BaseUrlSection } from '@/components/shared/features/settings/ai-provider/base-url-section';
import type { SectionForm } from '@/components/shared/features/settings/ai-provider/types';

function Harness() {
  const form = useForm({ defaultValues: DEFAULT_OPERATIONAL_CONFIG });
  return <BaseUrlSection form={form as unknown as SectionForm} />;
}

function renderSection() {
  return render(<Harness />);
}

afterEach(() => {
  cleanup();
});

describe('BaseUrlSection', () => {
  it('shows the configured provider endpoint', () => {
    renderSection();
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    expect(input.value).toBe('https://openrouter.ai/api/v1');
  });

  it('accepts the OpenAI endpoint as an alternative', () => {
    renderSection();
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://api.openai.com/v1' } });
    expect(input.value).toBe('https://api.openai.com/v1');
  });

  it('rejects a non-URL value with a validation error', () => {
    renderSection();
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    fireEvent.blur(input);
    // The section must surface the invalid state on the field element.
    expect(input.closest('[data-invalid]')?.getAttribute('data-invalid')).toBe('true');
  });
});

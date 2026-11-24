// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from '@tanstack/react-form';
import { AI_PROVIDER_CHOICES, DEFAULT_OPERATIONAL_CONFIG } from '@jobhunter/core/config/schemas';

import { ProviderSection } from '@/components/shared/features/settings/ai-provider/provider-section';
import type { SectionForm } from '@/components/shared/features/settings/ai-provider/types';

interface FormHandle {
  readonly state: { readonly values: typeof DEFAULT_OPERATIONAL_CONFIG };
}

let latestForm: FormHandle | null = null;

function Harness() {
  const form = useForm({ defaultValues: DEFAULT_OPERATIONAL_CONFIG });
  latestForm = form as unknown as FormHandle;
  return <ProviderSection form={form as unknown as SectionForm} />;
}

function renderSection() {
  latestForm = null;
  return render(<Harness />);
}

function selectProvider(label: string) {
  fireEvent.click(screen.getByRole('combobox'));
  const option = screen.getByRole('option', { name: label });
  fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
  fireEvent.click(option);
}

afterEach(() => {
  cleanup();
  latestForm = null;
});

describe('ProviderSection', () => {
  it('shows the selected provider', () => {
    renderSection();
    expect(screen.getByRole('combobox').textContent).toContain('OpenRouter');
  });

  it('lists every catalog provider in the select', () => {
    renderSection();
    fireEvent.click(screen.getByRole('combobox'));
    for (const choice of AI_PROVIDER_CHOICES) {
      expect(screen.getByRole('option', { name: choice.label })).toBeDefined();
    }
  });

  it('reveals the base URL field only for custom providers', () => {
    renderSection();
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
    selectProvider('Custom…');
    expect(screen.getByLabelText(/base url/i)).toBeDefined();
    selectProvider('OpenAI');
    expect(screen.queryByLabelText(/base url/i)).toBeNull();
  });

  it('keeps the custom URL while custom is selected and clears it when switching away', async () => {
    renderSection();
    selectProvider('Custom…');
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://compat-proxy.example/v1' } });
    expect(input.value).toBe('https://compat-proxy.example/v1');
    selectProvider('Groq');
    await waitFor(() => {
      expect(latestForm!.state.values.aiProvider.baseUrl).toBeUndefined();
    });
    expect(latestForm!.state.values.aiProvider.provider).toBe('groq');
  });

  it('rejects a non-URL custom base URL with a validation error', () => {
    renderSection();
    selectProvider('Custom…');
    const input = screen.getByLabelText(/base url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not-a-url' } });
    fireEvent.blur(input);
    expect(input.closest('[data-invalid]')?.getAttribute('data-invalid')).toBe('true');
  });
});

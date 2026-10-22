// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LoggingSection } from '@/components/shared/features/settings/logging/logging-section';
import type {
  AnyFieldApi,
  SectionForm,
} from '@/components/shared/features/settings/search-config/types';

function makeField(name: string): AnyFieldApi {
  return {
    name,
    state: {
      value: 'info',
      meta: { isTouched: false, isValid: true, errors: [] },
    },
    handleChange: () => {},
    handleBlur: () => {},
  } as unknown as AnyFieldApi;
}

const form: SectionForm = {
  Field: ({ name, children }) => children(makeField(name)),
};

afterEach(() => {
  cleanup();
});

describe('<LoggingSection />', () => {
  it('renders threshold help text alongside the log level selector', () => {
    render(<LoggingSection form={form} />);

    expect(screen.getByText('Log level')).toBeTruthy();
    expect(screen.getByText(/A threshold, not a category/i)).toBeTruthy();
    expect(screen.getByText(/hides all warnings/i)).toBeTruthy();
  });
});

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import type { SectionForm } from '@/components/shared/features/settings/search-config/types';
import { ScrapperSection } from '@/components/shared/features/settings/scrapper/scrapper-section';
import { LoggingSection } from '@/components/shared/features/settings/logging/logging-section';
import { DiagnosisSection } from '@/components/shared/features/settings/diagnosis/diagnosis-section';
import { RefusalDetectionSection } from '@/components/shared/features/settings/ai-provider/refusal-detection-section';

interface AdvancedSectionProps {
  form: SectionForm;
}

export function AdvancedSection({ form }: AdvancedSectionProps) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Tuning options for diagnosing scraping and scoring problems.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Most people never need to change these. Browser timeouts, diagnostic capture, and the
            refusal-detection phrase list exist to diagnose failures, not to be tuned day to day.
            Raising a timeout usually makes a run slower and more likely to be rate-limited, so
            changing one without a reason to can make the problem worse.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => setRevealed(true)}
          >
            Show advanced settings
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle>Advanced</CardTitle>
        <CardDescription>
          Tuning options for diagnosing scraping and scoring problems.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ScrapperSection form={form} />
        <SectionDivider />
        <LoggingSection form={form} />
        <SectionDivider />
        <DiagnosisSection form={form} />
        <SectionDivider />
        <RefusalDetectionSection form={form} />
      </CardContent>
    </>
  );
}

import { describe, expect, it } from 'vitest';

import type { ExtractedProfile } from '../../src/profile/openai/structured-output.js';
import type { SourceReference } from '../../src/profile/schema.js';
import { detectProfileConflicts } from '../../src/profile/conflicts.js';

function ref(sourceId: string): SourceReference {
  return { sourceId, section: null, excerpt: null };
}

function baseProfile(): ExtractedProfile {
  return {
    basics: {
      headline: null,
      professionalSummary: null,
      currentLocation: null,
      totalYearsOfExperience: null,
    },
    experience: [],
    skills: [],
    languages: [],
    education: [],
    certifications: [],
    projects: [],
    warnings: [],
  };
}

describe('detectProfileConflicts', () => {
  it('returns no conflicts when only one source is present', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
      ],
    };
    expect(detectProfileConflicts(profile, ['source-1'])).toEqual([]);
  });

  it('does not flag identical endDate for the same company + title from two sources', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    expect(detectProfileConflicts(profile, ['source-1', 'source-2'])).toEqual([]);
  });

  it('flags a single endDate conflict for the same company + title from two sources', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '2020-01',
          endDate: '2023-06',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    const conflicts = detectProfileConflicts(profile, ['source-1', 'source-2']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflictType: 'work_experience.end_date',
      affectedField: 'endDate',
      valueSourceA: '2022-01',
      valueSourceB: '2023-06',
      provisionalValue: '2022-01',
    });
  });

  it('flags a single location conflict for the same company + title from two sources', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: null,
          isCurrent: true,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Lisbon',
          startDate: '2020-01',
          endDate: null,
          isCurrent: true,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    const conflicts = detectProfileConflicts(profile, ['source-1', 'source-2']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      conflictType: 'work_experience.location',
      affectedField: 'location',
      valueSourceA: 'Remote',
      valueSourceB: 'Lisbon',
    });
  });

  it('returns no conflicts when there are no overlapping company + title entries', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Globex',
          title: 'Senior Engineer',
          location: 'Lisbon',
          startDate: '2022-02',
          endDate: '2024-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    expect(detectProfileConflicts(profile, ['source-1', 'source-2'])).toEqual([]);
  });

  it('includes sourceReferences from both sources on the detected conflict', () => {
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Lisbon',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    const conflicts = detectProfileConflicts(profile, ['source-1', 'source-2']);
    expect(conflicts).toHaveLength(1);
    const sourceIds = conflicts[0]?.sourceReferences.map((r) => r.sourceId) ?? [];
    expect(sourceIds).toContain('source-1');
    expect(sourceIds).toContain('source-2');
  });

  it('does not flag two entries whose comparable fields are deeply equal across sources', () => {
    // The deepEqual helper must treat reference-distinct strings with the
    // same value, and arrays with the same elements, as equal. Neither source
    // disagrees on any field, so no conflict is reported.
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: 'Built APIs',
          responsibilities: ['APIs', 'Services'],
          achievements: ['Reduced latency'],
          technologies: ['TypeScript', 'Node.js'],
          domains: ['fintech'],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: 'Built APIs',
          responsibilities: ['APIs', 'Services'],
          achievements: ['Reduced latency'],
          technologies: ['TypeScript', 'Node.js'],
          domains: ['fintech'],
          sourceReferences: [ref('source-2')],
        },
      ],
    };
    expect(detectProfileConflicts(profile, ['source-1', 'source-2'])).toEqual([]);
  });

  it('does not flag a conflict when one of the sourceIds is not in knownSourceIds', () => {
    // The "source-phantom" reference was not supplied in the request and
    // must be ignored even though the locations disagree.
    const profile: ExtractedProfile = {
      ...baseProfile(),
      experience: [
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-1')],
        },
        {
          company: 'Acme',
          title: 'Engineer',
          location: 'Lisbon',
          startDate: '2020-01',
          endDate: '2022-01',
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [ref('source-phantom')],
        },
      ],
    };
    expect(detectProfileConflicts(profile, ['source-1'])).toEqual([]);
  });
});

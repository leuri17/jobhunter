# JobHunter — MVP Specification

**Status:** Ready for task planning  
**Target:** Local, single-user CLI application  
**Runtime:** TypeScript on Node.js  
**Primary source:** LinkedIn public job search  
**Authentication:** None  
**Package manager:** pnpm  
**Last consolidated:** 2026-07-30

---

## 1. Overview

JobHunter is a local CLI pipeline that discovers, extracts, filters, scores, stores, and ranks job listings for one user.

The MVP pipeline is:

1. Initialize local application state.
2. Import one or two CV sources.
3. Extract a structured professional profile with OpenAI.
4. Review, edit, and explicitly approve the profile.
5. Configure multiple LinkedIn search queries and locations interactively.
6. Generate every query/location search combination.
7. Scrape LinkedIn's public job-search pages without authentication.
8. Extract complete job details from the embedded detail panel, with a dedicated job-page fallback.
9. Persist complete, partial, and failed extraction outcomes locally.
10. Apply one global deterministic pre-filter configuration.
11. Score accepted jobs against the active profile using OpenAI.
12. Calculate the final weighted score deterministically in JobHunter.
13. Rank jobs by the calculated score.
14. Display the top-ranked jobs in the terminal.
15. Provide commands for inspecting, listing, and reevaluating stored jobs and runs.

The MVP is optimized for local execution, inspectability, reproducible decisions, and fast development iteration.

---

## 2. Goals

JobHunter must:

- Run entirely on the user's machine.
- Require no hosted application services.
- Support one user and one active approved professional profile.
- Support multiple search queries and multiple locations.
- Scrape as many public LinkedIn results as the page makes available.
- Avoid duplicate jobs across searches and runs.
- Isolate failures to the smallest possible scope.
- Keep extraction, filtering, and scoring as separate persisted stages.
- Reuse valid cached results.
- Invalidate filtering and scoring results when their inputs change.
- Preserve diagnostic information for partial and failed jobs.
- Produce useful terminal output without requiring a web interface.
- Support machine-readable output for selected read-only commands.
- Preserve historical profile, filter, extraction, and scoring results for traceability.

---

## 3. Non-goals

The following are outside the MVP:

- Telegram, email, or push notifications
- Web or desktop UI
- Scheduled or background runs
- Multiple users
- Multiple active profiles
- Hosted authentication
- Cloud synchronization
- Cover-letter generation
- CV rewriting or tailoring
- Application tracking
- Automated applications
- Job sources other than LinkedIn
- LLM providers other than OpenAI
- Authenticated LinkedIn scraping
- LinkedIn credential storage
- Automated LinkedIn login
- Automatic location-to-`geoId` resolution from plain-text locations
- Experience-level LinkedIn filters
- Employment-type LinkedIn filters
- Automatic retry of partial extraction records
- Automatic refresh of complete job descriptions
- OCR or image-based CV extraction
- Alternate public configuration-file paths
- Standalone executable packaging
- Cloud deployment

Future functionality must be defined in follow-up specifications.

---

## 4. User and operating model

### 4.1 Primary user

The MVP is designed for one job seeker operating JobHunter on their own machine.

The user:

- Has one active approved professional profile.
- Maintains one local operational configuration.
- Runs the pipeline manually.
- Reviews results in the terminal.
- Is comfortable inspecting configuration, logs, and scraper diagnostics.
- Is initially also the developer and operator.

### 4.2 Product priorities

The MVP should prioritize:

- Simple local setup
- Typed interfaces
- Modular pipeline stages
- Explicit configuration
- Inspectable database records
- Reproducible filtering and scoring
- Useful errors and logs
- Deterministic behavior where practical
- Fast iteration over polished UX

---

## 5. Technology decisions

### 5.1 Runtime and package manager

JobHunter must use:

- Node.js `24.18.0`
- TypeScript
- pnpm `11.18.0`

`package.json` must declare:

```json
{
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "packageManager": "pnpm@11.18.0"
}
```

The repository must also pin Node.js `24.18.0` through a runtime-version file such as `.node-version`.

The pnpm lockfile must be committed.

### 5.2 TypeScript build and module configuration

JobHunter must use native ECMAScript modules.

The project must use:

- TypeScript strict mode
- `module: "NodeNext"`
- `moduleResolution: "NodeNext"`
- `tsc` for production builds
- `tsx` for local development
- `dist/` for compiled output
- Source maps for compiled code

`package.json` must include:

```json
{
  "type": "module"
}
```

The TypeScript configuration should enable at least:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": true,
    "rootDir": "src",
    "outDir": "dist"
  }
}
```

Production execution must use compiled JavaScript from `dist/`.

### 5.3 CLI and prompting

JobHunter must use:

- Commander.js for command routing, subcommands, options, argument parsing, and help output
- `@inquirer/prompts` for interactive CLI workflows

Command handlers must delegate work to application services rather than containing scraper, persistence, filtering, or scoring logic directly.

Prompt definitions must remain separate from application services so interactive workflows can be tested without a terminal.

### 5.4 Browser automation

JobHunter must use:

- Playwright
- Chromium
- Headless execution by default

The scraper must create a fresh unauthenticated browser context for each run.

A future debugging option may expose headed execution, but headed mode is not required for the MVP.

### 5.5 Persistence

JobHunter must use:

- SQLite
- Drizzle ORM
- `better-sqlite3`

The database must be a local file.

The application must:

- Enable SQLite foreign-key enforcement.
- Use committed schema migrations.
- Apply pending migrations during initialization.
- Wrap logically related writes in transactions.
- Access persistence through repositories or storage interfaces.
- Keep direct database access out of scraper, filter, and scorer implementations.

### 5.6 Validation

JobHunter must use Zod for runtime validation.

Zod schemas must validate:

- Operational configuration
- Search configuration
- Filter configuration
- Professional profile drafts and approved versions
- OpenAI structured outputs
- CLI inputs
- Database-bound structured JSON fields
- Versioned persisted data loaded from disk

TypeScript types should be inferred from Zod schemas where practical.

### 5.7 Logging

JobHunter must use Pino.

Persisted logs must use structured JSON. Terminal output may use human-readable formatting.

Logs should include, when available:

- Timestamp
- Level
- Component
- Event name
- Pipeline run ID
- Search execution ID
- Source job ID
- Error code
- Human-readable message
- Structured metadata

The default log level is `info`.

### 5.8 Testing

JobHunter must use Vitest for:

- Unit tests
- Integration tests
- Fixture-based scraper tests

Live LinkedIn tests must require explicit execution and must not run in CI by default.

Suggested scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:live": "vitest run --config vitest.live.config.ts"
  }
}
```

---

## 6. High-level architecture

The expected components are:

- CLI
- Configuration manager
- Interactive search-configuration workflow
- Interactive filter-configuration workflow
- Profile source reader
- Profile text extractor
- AI profile extractor
- Profile validator
- Interactive profile review and editor
- Search-matrix generator
- LinkedIn URL builder
- LinkedIn scraper
- Job extraction service
- Deterministic filter engine
- OpenAI scoring service
- Ranking service
- Persistence layer
- Logging service
- Diagnostic artifact manager

The logical pipeline stages are:

1. Initialization
2. Configuration validation
3. Profile loading
4. Search-matrix generation
5. LinkedIn search execution
6. Job discovery
7. Job detail extraction
8. Extraction persistence
9. Deterministic filtering
10. Scoring-plan confirmation
11. LLM scoring
12. Ranking
13. Terminal output
14. Run finalization

Extraction, filtering, and scoring must have independent persistence and invalidation rules.

---

## 7. OS-specific application directories

JobHunter must store configuration, application data, logs, cache files, and diagnostics in operating-system-specific user directories.

It must not store user data in the current project directory by default.

### 7.1 Directory categories

JobHunter must resolve:

- `config` — operational configuration
- `data` — SQLite and persistent source/profile data
- `logs` — application logs
- `diagnostics` — screenshots, traces, HTML snapshots, and error metadata
- `cache` — disposable or derived files

### 7.2 Linux

```text
Configuration:
$XDG_CONFIG_HOME/jobhunter
Fallback: ~/.config/jobhunter

Persistent data:
$XDG_DATA_HOME/jobhunter
Fallback: ~/.local/share/jobhunter

Logs and diagnostics:
$XDG_STATE_HOME/jobhunter
Fallback: ~/.local/state/jobhunter

Cache:
$XDG_CACHE_HOME/jobhunter
Fallback: ~/.cache/jobhunter
```

### 7.3 macOS

```text
Configuration and persistent data:
~/Library/Application Support/JobHunter

Logs:
~/Library/Logs/JobHunter

Diagnostics:
~/Library/Application Support/JobHunter/diagnostics

Cache:
~/Library/Caches/JobHunter
```

### 7.4 Windows

```text
Configuration:
%APPDATA%\JobHunter

Persistent data:
%LOCALAPPDATA%\JobHunter

Logs:
%LOCALAPPDATA%\JobHunter\logs

Diagnostics:
%LOCALAPPDATA%\JobHunter\diagnostics

Cache:
%LOCALAPPDATA%\JobHunter\cache
```

### 7.5 Default files and directories

Resolved paths should include:

```text
config.json
jobhunter.sqlite
logs/
diagnostics/
cache/
profile-sources/
```

### 7.6 Path behavior

JobHunter must:

- Create missing directories only when first required.
- Avoid creating all directories for commands such as `--help`.
- Produce a clear error when a required directory cannot be created or written.
- Never silently fall back to the current working directory.
- Use platform path APIs.
- Expose resolved paths through:

```text
jobhunter paths
```

`jobhunter paths` must not create missing paths.

---

## 8. Configuration and database responsibility

### 8.1 `config.json`

The OS-specific `config.json` must contain operational settings, including:

- Configuration schema version
- LinkedIn search settings
- OpenAI models
- OpenAI reasoning settings
- OpenAI scoring concurrency
- Browser timeouts
- Scraper retry limits
- Output limits
- Logging settings
- Diagnostic settings

Example:

```json
{
  "version": 1,
  "search": {
    "searchQueries": ["Software developer", "Frontend developer"],
    "locations": [
      {
        "name": "Rotterdam",
        "geoId": "100467493"
      }
    ],
    "datePosted": 86400,
    "workplaceTypes": ["1", "2", "3"]
  },
  "openai": {
    "profileExtraction": {
      "model": "gpt-5.6-sol",
      "reasoningEffort": "medium"
    },
    "jobScoring": {
      "model": "gpt-5.6-sol",
      "reasoningEffort": "medium",
      "concurrency": 3
    }
  },
  "scraper": {
    "timeouts": {
      "navigationMs": 30000,
      "initialResultsMs": 20000,
      "detailPanelMs": 10000,
      "dedicatedPageMs": 20000,
      "overlayDismissalMs": 5000
    },
    "maxNoProgressAttempts": 3
  },
  "output": {
    "runTopN": 20,
    "jobsListDefaultLimit": 50
  },
  "logging": {
    "level": "info",
    "prettyTerminal": true
  },
  "diagnostics": {
    "onScraperError": {
      "screenshot": true,
      "currentUrl": true,
      "stackTrace": true,
      "playwrightTrace": false,
      "htmlSnapshot": false
    }
  }
}
```

### 8.2 SQLite

SQLite must store data requiring history, identity, approval, or lifecycle management, including:

- Imported profile sources
- Profile drafts and revisions
- Profile approval history
- Manual derived-value overrides
- Global filter configuration versions
- Pipeline runs
- Search executions
- Jobs and discovery events
- Extraction attempts
- Filter results
- Score results
- Errors
- Diagnostic artifact references

### 8.3 Configuration loading

Before an affected command executes, JobHunter must:

1. Resolve the OS-specific configuration path.
2. Read `config.json`.
3. Parse JSON.
4. Validate with Zod.
5. Apply documented defaults.
6. Normalize into canonical form.
7. Calculate a deterministic SHA-256 hash.

Unknown properties must be rejected by MVP schemas.

### 8.4 Run configuration snapshot

Every pipeline run must persist:

- Normalized configuration snapshot
- Configuration schema version
- SHA-256 hash
- Application version
- Run creation timestamp

The snapshot must exclude secrets and environment-variable values.

### 8.5 Configuration updates

Interactive configuration commands must:

- Modify only their owned section.
- Preserve unrelated valid sections.
- Validate the complete resulting configuration.
- Show a change preview.
- Request confirmation before replacing existing values.
- Write through a temporary file.
- Atomically replace the previous configuration only after validation succeeds.

### 8.6 Configuration path

The MVP must not support:

- `--config`
- Per-command configuration paths
- Configuration-path environment variables
- Project-local configuration files

---

## 9. Guided initialization

JobHunter must provide:

```text
jobhunter init
```

### 9.1 Initialization sequence

The command must:

1. Resolve OS-specific paths.
2. Create required directories.
3. Initialize SQLite.
4. Apply Drizzle migrations.
5. Create a default `config.json` when missing.
6. Validate the OpenAI API key without persisting it.
7. Run search configuration.
8. Run profile import.
9. Generate an AI profile draft.
10. Guide review and editing.
11. Require explicit profile approval.
12. Run global filter configuration.
13. Display a final setup summary.
14. Indicate that `jobhunter run` is ready.

### 9.2 OpenAI API key

The MVP must read:

```text
OPENAI_API_KEY
```

When missing, initialization must:

- Explain how to supply it.
- Avoid asking the user to persist it in `config.json`.
- Stop before OpenAI-dependent steps.
- Preserve completed initialization work.

### 9.3 Existing state

`jobhunter init` must not silently overwrite:

- Existing `config.json`
- Existing database
- Existing approved profile
- Existing filter configuration
- Imported profile sources

### 9.4 Partial initialization

Initialization may remain partial when:

- The OpenAI API key is missing.
- Profile extraction fails.
- The user rejects the profile.
- Blocking conflicts remain unresolved.
- The user cancels a step.

Completed work must remain persisted.

### 9.5 Completion requirements

Initialization is complete only when all of these exist:

- Valid operational configuration
- At least one search query
- At least one location
- One active approved profile
- One active global filter configuration
- Initialized and migrated database

### 9.6 Idempotent and resumable behavior

`jobhunter init` must be safe to run repeatedly.

Each step must be classified as:

- `complete`
- `incomplete`
- `failed`
- `not_started`

The command must reuse valid state and continue from the first incomplete prerequisite.

Normal resume behavior must not:

- Recreate existing directories unnecessarily
- Reinitialize a migrated database
- Reimport identical sources
- Re-extract a profile when a valid draft exists
- Replace an active profile
- Recreate an active filter configuration
- Rewrite unchanged search configuration
- Delete or reset existing data

---

## 10. Search configuration

### 10.1 Source of truth

Search settings must be persisted in `config.json`.

The user must not be required to edit JSON manually.

The MVP must provide:

```text
jobhunter configure search
```

### 10.2 Persisted schema

Example:

```json
{
  "version": 1,
  "searchQueries": ["Software developer", "Frontend developer"],
  "locations": [
    {
      "name": "Rotterdam",
      "geoId": "100467493"
    }
  ],
  "datePosted": 86400,
  "workplaceTypes": ["1", "2", "3"]
}
```

### 10.3 Search queries

`searchQueries` must:

- Contain one or more non-empty strings.
- Trim leading and trailing whitespace.
- Collapse repeated internal whitespace for comparison.
- Reject empty values.
- Deduplicate case-insensitively after Unicode and whitespace normalization.
- Preserve the spelling and casing of the first occurrence.
- Preserve deterministic order.
- Map each retained value to LinkedIn's `keywords` parameter.

For example, `"Software Developer"` and `"software developer"` represent one configured query. JobHunter must retain the first display value and execute one LinkedIn search for that normalized query.

### 10.4 Locations

Persisted locations must contain:

- `name`
- `geoId`

Validation:

- At least one location is required.
- `name` must contain non-whitespace text.
- `geoId` must be non-empty.
- Locations must be deduplicated by `geoId`.

### 10.5 Date posted

| Label         | Persisted value | URL parameter    |
| ------------- | --------------: | ---------------- |
| Past 24 hours |         `86400` | `f_TPR=r86400`   |
| Past week     |        `604800` | `f_TPR=r604800`  |
| Past month    |       `2592000` | `f_TPR=r2592000` |

Rules:

- Default: `86400`
- No other value is valid in the MVP.

### 10.6 Workplace types

| Label   | Persisted value |
| ------- | --------------- |
| On-site | `"1"`           |
| Remote  | `"2"`           |
| Hybrid  | `"3"`           |

Rules:

- Default: `["1", "2", "3"]`
- At least one value is required.
- Values must not be duplicated.
- Values must be stored in deterministic order.
- No other value is valid.

### 10.7 Unsupported LinkedIn filters

The MVP must not include:

- Experience level
- Employment type
- Company
- Industry
- Job function
- Other LinkedIn filters not explicitly listed

### 10.8 Interactive flow

The command must:

1. Load existing search configuration when present.
2. Ask for one or more search queries.
3. Present date-posted choices using human-readable labels.
4. Present workplace types as a multi-select.
5. Ask for one or more LinkedIn jobs-search URLs.
6. Parse each URL.
7. Extract `geoId`.
8. Extract a human-readable location name when possible.
9. Ask for a label when it cannot be extracted reliably.
10. Deduplicate by `geoId`.
11. Show normalized configuration.
12. Show the number of generated searches.
13. Ask for confirmation.
14. Write atomically.

### 10.9 Location URL parsing

For each pasted URL, JobHunter must:

- Validate LinkedIn hostname.
- Validate a supported jobs-search path.
- Extract `geoId`.
- Reject missing `geoId`.
- Reject malformed or unsupported URLs clearly.
- Support multiple URLs.
- Avoid persisting the original pasted URL unless later required for diagnostics.

Automatic resolution from plain text is outside the MVP.

---

## 11. LinkedIn search URL generation

### 11.1 Search matrix

JobHunter must generate the Cartesian product of:

- Every search query
- Every location

The number of searches is:

```text
searchQueries.length × locations.length
```

`datePosted` and `workplaceTypes` apply globally to all generated searches.

### 11.2 URL mapping

| Configuration value  | LinkedIn parameter         |
| -------------------- | -------------------------- |
| `searchQueries[i]`   | `keywords`                 |
| `locations[j].geoId` | `geoId`                    |
| `datePosted`         | `f_TPR`, prefixed with `r` |
| `workplaceTypes`     | `f_WT`, comma-separated    |
| Constant             | `sortBy=DD`                |

`sortBy=DD` must always be included.

### 11.3 URL construction

Base URL:

```text
https://www.linkedin.com/jobs/search/
```

Logical URL:

```text
https://www.linkedin.com/jobs/search/?f_TPR=r{datePosted}&f_WT={workplaceTypes}&geoId={geoId}&keywords={query}&sortBy=DD
```

The implementation must use `URL` and `URLSearchParams`, or an equivalent parameter-aware builder.

The complete URL must not be encoded as one value.

### 11.4 Search execution persistence

Every generated query/location pair must be persisted as an independent search execution containing:

- Pipeline run
- Query
- Location name
- `geoId`
- Generated URL
- Start and end timestamps
- Final status
- Jobs discovered
- New jobs
- Existing jobs
- Errors
- Diagnostic references

---

## 12. Professional profile schema

### 12.1 Canonical schema

```ts
type YearMonth = string; // "YYYY" or "YYYY-MM"

interface ProfessionalProfile {
  schemaVersion: 1;

  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;

  sourceIds: string[];

  basics: {
    headline: string | null;
    professionalSummary: string | null;
    currentLocation: string | null;
    totalYearsOfExperience: number | null;
  };

  experience: WorkExperience[];
  skills: Skill[];
  languages: Language[];
  education: Education[];
  certifications: Certification[];
  projects: Project[];

  derived: {
    likelySeniority: DerivedValue<SeniorityLevel | null>;
    primaryRoles: DerivedValue<string[]>;
    primaryDomains: DerivedValue<string[]>;
    strongestSkills: DerivedValue<string[]>;
  };
}

interface DerivedValue<T> {
  generatedValue: T;
  overrideActive: boolean;
  overrideValue: T | null;
  effectiveValue: T;
  generatedAt: string | null;
  overriddenAt: string | null;
}

interface WorkExperience {
  id: string;
  company: string;
  title: string;
  location: string | null;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  isCurrent: boolean;
  summary: string | null;
  responsibilities: string[];
  achievements: string[];
  technologies: string[];
  domains: string[];
  sourceReferences: SourceReference[];
}

interface Skill {
  id: string;
  name: string;
  normalizedName: string;
  category: SkillCategory;
  proficiency: SkillProficiency | null;
  yearsOfExperience: number | null;
  lastUsedAt: YearMonth | null;
  evidence: SkillEvidence[];
}

interface SkillEvidence {
  sourceType: 'experience' | 'project' | 'certification' | 'explicit_cv_section';
  sourceEntityId: string | null;
  description: string | null;
}

interface Language {
  id: string;
  name: string;
  normalizedName: string;
  level: LanguageLevel | null;
  sourceReferences: SourceReference[];
}

interface Education {
  id: string;
  institution: string;
  qualification: string | null;
  fieldOfStudy: string | null;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  location: string | null;
  sourceReferences: SourceReference[];
}

interface Certification {
  id: string;
  name: string;
  issuer: string | null;
  issuedAt: YearMonth | null;
  expiresAt: YearMonth | null;
  credentialId: string | null;
  credentialUrl: string | null;
  sourceReferences: SourceReference[];
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  role: string | null;
  startDate: YearMonth | null;
  endDate: YearMonth | null;
  technologies: string[];
  achievements: string[];
  url: string | null;
  sourceReferences: SourceReference[];
}

interface SourceReference {
  sourceId: string;
  section: string | null;
  excerpt: string | null;
}

type SkillCategory =
  | 'programming_language'
  | 'framework'
  | 'library'
  | 'database'
  | 'cloud'
  | 'devops'
  | 'testing'
  | 'architecture'
  | 'tool'
  | 'methodology'
  | 'domain'
  | 'soft_skill'
  | 'other';

type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

type LanguageLevel = 'basic' | 'conversational' | 'professional' | 'fluent' | 'native';

type SeniorityLevel =
  | 'intern'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'manager'
  | 'director'
  | 'executive';
```

### 12.2 Normalized names

`name` preserves the human-readable value.

`normalizedName` is generated by deterministic application code for matching and deduplication.

Examples:

| `name`        | `normalizedName` |
| ------------- | ---------------- |
| `Node.js`     | `nodejs`         |
| `NodeJS`      | `nodejs`         |
| `React.js`    | `react`          |
| `Type Script` | `typescript`     |
| `PostgreSQL`  | `postgresql`     |
| `English`     | `english`        |

Normalization must:

- Trim whitespace.
- Convert to lowercase.
- Normalize Unicode.
- Normalize punctuation and separators.
- Apply a version-controlled alias map.
- Preserve the original display value.

`normalizedName` must not be manually editable.

### 12.3 Preferences are separate

Search and filtering preferences must not be stored as extracted professional facts.

They belong to the search configuration and global filter configuration.

---

## 13. CV source persistence and text extraction

### 13.1 Supported sources

JobHunter must support one or two file sources:

- PDF
- Markdown
- Plain text

Inline CV text, standard-input CV content, and pasted-text profile sources are outside the MVP.

### 13.2 Profile import command

The command must accept one or two file paths:

```text
jobhunter profile import <source-path> [second-source-path]
```

The command must reject:

- Zero source paths
- More than two source paths
- Unsupported file formats
- Inline CV text passed as positional content
- A `--paste` mode

After validating the source paths, the command must immediately execute the complete import and extraction workflow:

1. Copy or reuse the immutable source records.
2. Extract and normalize text locally.
3. Stop before OpenAI when any required source has unusable text.
4. Calculate the profile-extraction fingerprint.
5. Reuse an existing matching draft when appropriate.
6. Otherwise submit the normalized source content to OpenAI.
7. Validate and deterministically post-process the structured response.
8. Persist a new draft profile version.
9. Display the profile review summary and next available actions.

The command must never approve the generated profile automatically. The draft must still be edited, approved, or rejected explicitly.

If OpenAI extraction fails, imported source records and diagnostics must remain persisted, no invalid draft may be created, and the active approved profile must remain unchanged.

### 13.3 File import

For each imported file, JobHunter must:

1. Validate existence and readability.
2. Validate the supported format.
3. Read original bytes.
4. Calculate a SHA-256 hash.
5. Copy the source into the application data directory.
6. Persist source metadata.
7. Extract and normalize text.
8. Persist extracted text separately.
9. Associate the source with the generated profile draft.

The imported copy is immutable.

Reimporting identical content must reuse the existing source record.

### 13.4 Source storage

Suggested structure:

```text
profile-sources/{source-id}/{original-filename}
```

Source metadata must include:

- Internal source ID
- Source type
- Original filename
- Original absolute path
- Stored path
- MIME type
- File size
- SHA-256 hash
- Import timestamp
- Extracted-text hash
- Text-extraction status
- Text-extraction warnings or errors

Later processing must use the stored copy rather than the original path.

### 13.5 PDF limitations

The MVP supports text-based PDFs only.

When usable text cannot be extracted, the source must:

- Be preserved with diagnostic metadata.
- Be marked failed.
- Return `ocr_required` when OCR appears necessary.
- Not be sent to OpenAI.
- Leave the approved profile unchanged.

OCR is outside the MVP.

---

## 14. AI profile extraction

### 14.1 Processing flow

```text
PDF / Markdown / text
        ↓
Local text extraction
        ↓
Text normalization
        ↓
OpenAI structured extraction
        ↓
Zod validation
        ↓
Deterministic normalization and deduplication
        ↓
Draft profile
        ↓
Interactive review and editing
        ↓
Explicit approval
```

### 14.2 Extraction behavior

JobHunter must use OpenAI to transform normalized CV text into the canonical profile schema.

The extractor must:

- Use only information supported by supplied sources.
- Store missing scalar values as `null`.
- Store missing collections as empty arrays.
- Avoid inventing employers, dates, qualifications, skills, achievements, or language levels.
- Preserve uncertainty as warnings or unresolved conflicts.
- Keep extracted facts separate from derived values.
- Associate entities with source references when possible.

### 14.3 Post-processing

After validation, JobHunter must:

- Regenerate normalized names.
- Deduplicate equivalent skills and languages.
- Validate dates.
- Validate enums.
- Verify internal references.
- Calculate experience durations when supported.
- Calculate the profile content hash.

### 14.4 Extraction metadata

Each profile version must record:

- Source document hashes
- Profile schema version
- Model identifier
- Prompt version
- Reasoning effort
- Structured-output schema version
- Profile extractor implementation version
- Extraction timestamp
- Validation warnings
- Unresolved conflicts

### 14.5 Extraction fingerprint

The profile-extraction fingerprint must include:

- Source hashes
- Profile schema version
- Prompt version
- Model identifier
- Relevant model configuration
- Extractor implementation version

Matching fingerprints may reuse an existing extraction.

A changed fingerprint must create a new draft rather than overwrite an existing profile version.

---

## 15. Multiple-source profile merging

When two sources are supplied:

- Neither has automatic precedence.
- Both are passed to OpenAI with distinct source IDs.
- Complementary facts should be merged.
- Equivalent duplicates should be deduplicated.
- Conflicts must not be silently resolved.
- Supporting source references must be preserved.

### 15.1 Conflicts

A conflict must include:

- Machine-readable type
- Affected field or entity
- Value from each source
- Source references
- Provisional selected value, when present
- Concise explanation

### 15.2 Draft behavior

A draft may contain a provisional value, but it must remain marked unresolved.

The review/editor must show:

- Both values
- Source references
- Provisional value
- Option to select either source value
- Option to enter another value
- Option to clear the field

### 15.3 Resolution

A conflict is resolved only by explicit user action.

The profile revision must preserve:

- Selected value
- Whether it came from a source or manual entry
- Resolution timestamp
- Original claims

A profile with unresolved conflicts cannot be approved.

---

## 16. Profile review, editing, approval, and overrides

### 16.1 Profile statuses

Supported statuses:

- `draft`
- `approved`
- `rejected`
- `superseded`

Only one profile may be active and approved.

### 16.2 Review summary

The review must show:

- Headline
- Professional summary
- Total experience
- Work experience
- Skills
- Languages
- Education
- Certifications
- Projects
- Generated and effective derived values
- Blocking conflicts
- Non-blocking warnings
- Missing or unresolved fields

### 16.3 Approval behavior

An AI-extracted profile starts as `draft`.

A draft must not be used for:

- Filtering
- Scoring
- Ranking
- Result invalidation

Approval must:

1. Validate the profile again.
2. Require all blocking conflicts to be resolved.
3. Show remaining warnings.
4. Require confirmation when warnings remain.
5. Mark the draft `approved`.
6. Make it active.
7. Mark the previous active profile `superseded`.
8. Calculate the final content hash.
9. Invalidate dependent filter and scoring results.
10. Preserve previous versions.

### 16.4 Rejection behavior

Rejection must:

- Mark the draft `rejected`.
- Preserve it.
- Leave the previous approved profile active.
- Avoid invalidating existing results.

### 16.5 Warning severity

Issues must be classified as:

- `blocking_conflict`
- `warning`

Only unresolved blocking conflicts prevent approval.

Warnings must be displayed and preserved, but approval may continue after explicit confirmation.

### 16.6 Interactive editor

Provisional command:

```text
jobhunter profile edit <profile-id>
```

Only drafts may be edited in place.

Editing an approved profile must create a new draft derived from it.

The editor must use a section menu:

- Basic information
- Work experience
- Skills
- Languages
- Education
- Certifications
- Projects
- Derived profile information
- Extraction warnings
- Review changes
- Save draft
- Discard changes
- Exit

Scalar editing must:

- Show the current value.
- Preserve the current value when Enter is pressed.
- Allow nullable fields to be cleared explicitly.
- Validate before accepting.

Collection editing must support:

- List
- View
- Add
- Edit
- Delete
- Reorder where meaningful

Deleting an entry requires confirmation.

### 16.7 Derived-value overrides

Derived fields support manual overrides:

- Likely seniority
- Primary roles
- Primary domains
- Strongest skills

Effective value:

```text
effectiveValue = overrideActive
  ? overrideValue
  : generatedValue
```

The application must distinguish:

- No override
- Override with a value
- Intentional override to empty or null

Users must be able to:

- View generated value
- Set override
- Change override
- Clear override

Regeneration must update only the generated value and preserve active overrides.

Filtering and scoring fingerprints must use effective derived values.

---

## 17. Global deterministic filter configuration

### 17.1 Global scope

The MVP must maintain one active global filter configuration.

The same rules apply to every job regardless of:

- Search query
- Location
- Search execution
- Pipeline run

The MVP must not support per-query or per-location rules.

### 17.2 Schema

```ts
interface JobFilterConfig {
  schemaVersion: 1;

  excludedCompanies: string[];

  title: {
    excludedKeywords: string[];
    requiredAnyKeywords: string[];
  };

  description: {
    excludedKeywords: string[];
    requiredAnyKeywords: string[];
  };

  seniority: {
    maximum: SeniorityLevel | null;
  };

  languages: {
    accepted: string[];
    rejectWhenExplicitlyRequiresOtherLanguage: boolean;
  };
}
```

### 17.3 Interactive configuration

JobHunter must provide:

```text
jobhunter configure filters
```

An active approved profile is required before the first filter configuration can be created.

The workflow must expose:

- Excluded companies
- Title excluded keywords
- Title required-any keywords
- Description excluded keywords
- Description required-any keywords
- Maximum seniority
- Accepted languages
- Language-rejection behavior
- Review configuration
- Save
- Discard
- Exit

The configuration must be immutable after persistence.

Every change creates a new version and marks affected results stale.

### 17.4 Excluded companies

Excluded companies reject normalized exact company-name matches.

The application must preserve display values while using normalized values for comparison.

### 17.5 Required-any behavior

When a required-any list is empty, that rule does not apply.

When non-empty, at least one configured keyword must match.

### 17.6 Accepted-language initialization

The initial accepted-language list must be preselected from the active approved profile.

The user may:

- Keep profile-derived languages
- Remove them
- Add other languages
- Re-add removed languages
- Enable or disable unsupported-language rejection

Approving a new profile must not silently overwrite the filter configuration.

Any synchronization must be explicit and previewed.

---

## 18. Deterministic keyword matching

All keyword rules must use a shared deterministic matcher.

Normalization must:

- Apply Unicode normalization.
- Convert to lowercase.
- Trim whitespace.
- Collapse repeated whitespace.
- Normalize separators such as `.`, `-`, `_`, and `/`.
- Preserve meaningful word boundaries.
- Apply a version-controlled alias map.

Rules:

- Matching is case-insensitive.
- Single-word rules use word boundaries.
- `Java` must not match `JavaScript`.
- Multi-word phrases are supported.
- Equivalent punctuation variants may match.
- Substring matching inside a larger word is not allowed by default.
- Stemming is not supported.
- Fuzzy matching is not supported.
- Typographical correction is not supported.
- User-provided regular expressions are not supported.

Example aliases:

- `node.js` → `nodejs`
- `node js` → `nodejs`
- `react.js` → `react`
- `postgres` → `postgresql`

Every filter decision must record the configured keyword and matched field.

---

## 19. Deterministic seniority detection

JobHunter must inspect explicit terms in the job title only.

Supported outcomes:

- `intern`
- `junior`
- `mid`
- `senior`
- `staff`
- `principal`
- `lead`
- `manager`
- `director`
- `executive`
- `unknown`

Example mapping:

| Title term                                | Result      |
| ----------------------------------------- | ----------- |
| `intern`, `internship`, `trainee`         | `intern`    |
| `junior`, `jr`, `graduate`, `entry level` | `junior`    |
| `mid`, `mid-level`, `intermediate`        | `mid`       |
| `senior`, `sr`                            | `senior`    |
| `staff`                                   | `staff`     |
| `principal`                               | `principal` |
| `lead`, `tech lead`, `team lead`          | `lead`      |
| `manager`, `engineering manager`          | `manager`   |
| `director`, `head of`                     | `director`  |
| `vp`, `vice president`, `chief`, `cto`    | `executive` |

Unlabelled titles produce `unknown`.

Examples:

- `Software Engineer` → `unknown`
- `Frontend Developer` → `unknown`
- `Senior Software Engineer` → `senior`

When multiple terms appear, the highest detected level applies.

The maximum-seniority rule must:

- Reject levels above the configured maximum.
- Accept levels equal to or below the maximum.
- Abstain for `unknown`.

OpenAI may infer likely job seniority during scoring, but it must not alter the deterministic filter result.

---

## 20. Deterministic language filtering

Language detection must use version-controlled phrase patterns.

It must not use OpenAI for pre-filtering.

### 20.1 Explicit requirements

Examples:

- `Dutch required`
- `Fluent Dutch required`
- `Must speak German`
- `Professional proficiency in French`
- `Native-level Spanish`
- `Excellent command of Italian`
- `Dutch is mandatory`

### 20.2 Non-rejecting references

Examples:

- `Dutch is a plus`
- `German preferred`
- `French would be beneficial`
- `Our team speaks Spanish`
- `Knowledge of Italian is desirable`
- Ambiguous references
- Languages mentioned only as part of a company, product, or location name

### 20.3 Rule behavior

When unsupported-language rejection is enabled:

- Accept when all explicit requirements are accepted.
- Reject when at least one explicit requirement is not accepted.
- Abstain when no explicit requirement is found.
- Abstain when wording cannot be classified reliably.

Abstention must not reject the job.

The result must record:

- Detected language
- Normalized language
- Matching phrase
- Requirement classification
- Whether accepted
- Final rule outcome

---

## 21. LinkedIn scraper

### 21.1 Access model

The scraper must operate only through publicly accessible LinkedIn jobs pages.

It must not:

- Request LinkedIn credentials
- Store credentials
- Log in automatically
- Reuse an authenticated profile
- Depend on authenticated content

If anonymous access is blocked and cannot be recovered, the scraper must stop with a typed access-blocked error.

Already persisted data must remain.

### 21.2 Browser lifecycle

Each run must:

- Start Playwright Chromium headlessly.
- Create a fresh browser context.
- Reuse the context for search and fallback pages.
- Close fallback pages after use.
- Close all pages, contexts, and browser processes on success or failure.

### 21.3 Search-page behavior

For each generated URL, the scraper must:

1. Navigate.
2. Validate the expected page.
3. Detect blocking or recoverable overlays.
4. Attempt to dismiss recoverable overlays.
5. Discover job cards.
6. Iterate job IDs.
7. Load additional results.
8. Continue until a deterministic end condition is met.

The MVP must not impose a per-search result cap.

### 21.4 End-of-results detection

The scraper must avoid infinite loops.

End conditions may include:

- Explicit end-of-results element
- Repeated load attempts with no new job IDs
- No increase in rendered result count
- Unavailable next-page or load-more mechanism

### 21.5 Overlay handling

Recoverable overlays include:

- Login dialogs
- Join dialogs
- Cookie consent
- Modal overlays blocking interaction

Possible dismissal strategies:

- Click close
- Press Escape
- Click outside
- Accept or reject cookie consent

An overlay that cannot be dismissed and blocks scraping must produce a typed error.

### 21.6 Default timeouts and attempts

| Operation                          |    Default |
| ---------------------------------- | ---------: |
| Page navigation                    | 30 seconds |
| Initial results load               | 20 seconds |
| Embedded panel load                | 10 seconds |
| Dedicated page load                | 20 seconds |
| Overlay dismissal                  |  5 seconds |
| Consecutive no-progress attempts   |          3 |
| Embedded-panel extraction attempts |          1 |
| Dedicated-page fallback attempts   |          1 |

All values must be configurable in `config.json`.

### 21.7 Sequential scraping

The MVP must:

- Run search executions sequentially.
- Process jobs sequentially within each search.
- Allow only one active embedded-panel extraction.
- Allow only one active fallback page.

---

## 22. Job identity and extraction

### 22.1 Canonical source ID

The LinkedIn job ID is the canonical external identifier:

```text
sourceJobId
```

### 22.2 Derived detail URL

```text
https://www.linkedin.com/jobs/view/{sourceJobId}/
```

The URL is derived and must not be treated as a scraped field.

### 22.3 Required fields

A job is complete only when it has:

- `sourceJobId`
- `title`
- `company`
- `location`
- `description`

### 22.4 Field validation

Every required text field must contain non-whitespace text after normalization.

### 22.5 Text normalization

Job text must:

- Trim whitespace.
- Normalize repeated whitespace.
- Remove presentation-only HTML.
- Preserve meaningful paragraphs.
- Preserve list boundaries.
- Avoid concatenating unrelated UI text.

### 22.6 Stage 1: embedded panel

For each discovered job requiring extraction, the scraper must:

1. Extract the job ID and card metadata.
2. Check local storage.
3. Select the card.
4. Wait for panel update.
5. Verify the panel belongs to the selected job.
6. Extract all required fields.

Successful method:

```text
search_detail_panel
```

### 22.7 Stage 2: dedicated page

Fallback occurs when:

- The panel does not load.
- The panel shows another job.
- Parsing fails.
- A required field is missing.
- An overlay prevents extraction.
- Timeout occurs.
- The panel structure is unsupported.

The fallback must:

1. Build the detail URL from `sourceJobId`.
2. Open a new page in the same browser context.
3. Wait for content.
4. Dismiss recoverable overlays.
5. Extract required fields.
6. Close the page.

Successful method:

```text
dedicated_job_page
```

### 22.8 Extraction statuses

#### `complete`

All required fields are valid.

#### `partial`

A valid `sourceJobId` exists, but one or more other required fields are missing or invalid.

#### `failed`

No reliable canonical job record can be created.

### 22.9 Complete-job behavior

When a job already exists as `complete`, JobHunter must skip extraction.

It must not:

- Open the panel for extraction
- Open the detail page
- Replace stored content
- Create a duplicate

A complete job is an immutable snapshot for the MVP.

### 22.10 Partial-job behavior

Partial jobs are diagnostic-only.

They must not:

- Be retried automatically
- Be filtered
- Be scored
- Appear in ranked results

When rediscovered, they must be skipped and the skip reason recorded.

### 22.11 Failed discoveries without source ID

JobHunter must not create a canonical job record.

Instead, it must create `job_discovery_error` containing:

- Run
- Search execution
- Card position or index
- Available metadata
- Error code
- Diagnostic message
- Timestamp
- Artifact references

These records are not deduplicated as jobs.

### 22.12 Failure isolation

One job failure must not terminate the entire run.

Search-level or browser-level failures may terminate the affected search or run only when safe continuation is impossible.

Already persisted data must remain.

---

## 23. Persistence and lifecycle

### 23.1 Minimum entities

SQLite must persist at least:

- Application metadata
- Profile sources
- Profile versions
- Profile revisions
- Profile conflicts and warnings
- Derived overrides
- Filter configuration versions
- Pipeline runs
- Search executions
- Jobs
- Discovery events
- Discovery errors
- Extraction attempts
- Filter results
- Score results
- OpenAI request metadata
- Diagnostic artifacts

### 23.2 Canonical job record

A canonical job should store:

- Integer primary key
- `sourceJobId`
- Title
- Company
- Location
- Description
- Extraction status
- Successful extraction method
- First discovery timestamp
- Last rediscovery timestamp
- Last extraction-attempt timestamp
- Created timestamp
- Updated timestamp

### 23.3 Discovery events

Every job discovery should record:

- Job
- Run
- Search execution
- Timestamp
- Whether new or known
- Current extraction state
- Whether extraction was attempted or skipped
- Skip reason

### 23.4 Historical results

Historical filter and score results must remain stored.

Only the result matching the current fingerprint is active.

### 23.5 Transactions

Transactions should be used when:

- Creating a run and its searches
- Persisting a new job and extraction
- Updating active filter results
- Updating active score results
- Finalizing run statistics

---

## 24. Filter lifecycle and fingerprints

### 24.1 Outcomes

Filter results must support:

- `accepted`
- `rejected`
- `error`

Rejected jobs must not proceed to scoring.

Filter errors must not be converted into rejections.

### 24.2 Stored filter details

Each result must store:

- Overall outcome
- Rules evaluated
- Rules passed
- Rules failed
- Explicit rejection reasons
- Filter configuration version/hash
- Relevant profile version/hash
- Filter implementation version
- Timestamp
- Filter fingerprint

### 24.3 Filter fingerprint

The fingerprint must include:

- Job content hash
- Active global filter configuration hash
- Relevant effective profile values
- Filter implementation version

A stored result may be reused only when the fingerprint matches.

---

## 25. OpenAI model and request behavior

### 25.1 Default model

The project-selected default model identifier for both operations is:

```text
gpt-5.6-sol
```

Operations must remain independently configurable:

```json
{
  "openai": {
    "profileExtraction": {
      "model": "gpt-5.6-sol",
      "reasoningEffort": "medium"
    },
    "jobScoring": {
      "model": "gpt-5.6-sol",
      "reasoningEffort": "medium",
      "concurrency": 3
    }
  }
}
```

### 25.2 Structured output

JobHunter must use structured output and validate the response with Zod.

### 25.3 Retry policy

Each OpenAI operation allows a maximum of three total attempts.

Retryable failures:

- Timeouts
- Rate limits
- Temporary network failures
- Server errors
- Invalid structured output, with at most one corrective retry

Non-retryable failures:

- Invalid credentials
- Permission errors
- Billing or quota configuration errors
- Invalid request parameters
- Unsupported model/configuration

Backoff must be exponential with jitter and respect server-provided retry delays.

### 25.4 Request persistence

JobHunter must not persist raw prompts or raw model responses by default.

It must store:

- Operation type
- Input hashes
- Prompt version
- Structured-output schema version
- Model
- Reasoning effort
- Relevant request configuration
- Token usage when available
- Validated structured output
- Attempt count
- Start/end timestamps
- Errors

### 25.5 Scoring concurrency

- Profile extraction: one request
- Job scoring: up to three concurrent requests by default
- Scoring concurrency is configurable and must be positive

### 25.6 Scoring request granularity

Each eligible job must use one independent OpenAI request.

Batching multiple jobs is outside the MVP.

### 25.7 Scoring input

Each request must contain:

- Active approved profile
- Extracted profile facts
- Effective derived values
- Complete normalized title
- Complete normalized company
- Complete normalized location
- Complete normalized description
- Versioned rubric
- Structured-output schema
- Prompt version

It must exclude:

- Database IDs
- Revision history
- CV source excerpts
- Original paths
- Extraction diagnostics
- Previous filter results
- Previous scores
- Run metadata
- Logs
- Diagnostic artifacts

### 25.8 No silent truncation

JobHunter must not silently:

- Truncate descriptions
- Remove experience
- Remove skills
- Summarize inputs
- Split one job across requests

When the full payload cannot be submitted, it must create:

```text
scoring_input_too_large
```

and continue with other jobs.

---

## 26. Scoring rubric and ranking

### 26.1 Eligibility

Only jobs that are:

- `complete`
- Currently `accepted`
- Complete enough for scoring

may be sent to OpenAI.

### 26.2 Rubric

| Category                             | Weight |
| ------------------------------------ | -----: |
| Technical skills                     |     30 |
| Relevant experience                  |     25 |
| Role and responsibility fit          |     20 |
| Seniority fit                        |     10 |
| Domain or industry fit               |      5 |
| Spoken-language compatibility        |      5 |
| Location and workplace compatibility |      5 |

OpenAI must return for every category:

- Score from `0` to `100`
- Concise explanation
- Relevant evidence

It must also return:

- Key matches
- Important gaps
- Important concerns
- Inferred job seniority when not explicit
- Recommendation summary

### 26.3 Overall score calculation

JobHunter, not OpenAI, calculates:

```text
overallScore =
  technicalSkills × 0.30 +
  relevantExperience × 0.25 +
  roleResponsibilityFit × 0.20 +
  seniorityFit × 0.10 +
  domainIndustryFit × 0.05 +
  spokenLanguageCompatibility × 0.05 +
  locationWorkplaceCompatibility × 0.05
```

No hidden bonuses or penalties are allowed.

### 26.4 Score precision

JobHunter must:

- Persist full precision.
- Rank using full precision.
- Display one decimal place.
- Return both full and display values in JSON where useful.

Example:

```json
{
  "overallScore": 84.5375,
  "displayScore": 84.5
}
```

### 26.5 Ranking

Ranking uses:

1. Full-precision overall score descending
2. `sourceJobId` ascending when exactly equal

No recency, preference, discovery-order, or filter-weight adjustments are allowed.

No minimum threshold applies by default.

---

## 27. Cache reuse and invalidation

### 27.1 Independent stages

Extraction, filtering, and scoring have independent cache behavior.

### 27.2 Extraction cache

A complete extraction is reused permanently in the MVP.

### 27.3 Score fingerprint

The score fingerprint must include:

- Job content hash
- Active profile version/hash
- Effective derived values
- Prompt version
- Rubric version
- Model identifier
- Reasoning effort
- Relevant model configuration
- Scorer implementation version

### 27.4 Stale results

When a fingerprint no longer matches:

- The old result remains stored.
- The old result becomes stale.
- It must not be used as current.
- The stage must rerun when the job is selected for evaluation.

### 27.5 Normal-run scope

`jobhunter run` processes only jobs discovered during that run.

For rediscovered jobs:

- Reuse complete extraction.
- Reuse current filter and score results.
- Re-filter or re-score when stale.

A normal run must not scan the entire database for stale jobs that were not rediscovered.

---

## 28. Explicit reevaluation

JobHunter must provide:

```text
jobhunter jobs reevaluate
jobhunter jobs reevaluate --filters-only
jobhunter jobs reevaluate --scores-only
jobhunter jobs reevaluate --job <job-id>
jobhunter jobs reevaluate --dry-run
```

### 28.1 Default

Process all complete jobs with stale or missing filter or score results.

### 28.2 `--filters-only`

- Reevaluate stale or missing filters.
- Make no OpenAI requests.
- Mark dependent scores stale when needed.

### 28.3 `--scores-only`

When the current filter is stale or missing:

- Skip the job.
- Make no OpenAI request.
- Report `filter_update_required`.

### 28.4 `--job`

May combine with:

- `--filters-only`
- `--scores-only`
- `--dry-run`

The selected job must be complete.

### 28.5 `--dry-run`

Must:

- Perform selection and fingerprint checks.
- Make no database changes.
- Make no OpenAI requests.
- Show filtering count.
- Show potential scoring count.
- Show skipped jobs and reasons.

### 28.6 Flag compatibility

`--filters-only` and `--scores-only` are mutually exclusive.

### 28.7 Confirmation

When reevaluation requires OpenAI requests, it must show a scoring plan and require confirmation.

`--yes` bypasses only that OpenAI confirmation.

`--yes` has no effect for:

- `--filters-only`
- `--dry-run`

---

## 29. Pipeline concurrency and cancellation

### 29.1 Scraping

- Searches run sequentially.
- Jobs within a search are processed sequentially.
- One panel extraction is active at a time.
- One fallback page is active at a time.

### 29.2 OpenAI

- One profile extraction request
- Up to three concurrent job-scoring requests by default
- One job per request

### 29.3 Graceful cancellation

On `Ctrl+C`, JobHunter must:

1. Mark the run as cancelling.
2. Stop scheduling new work.
3. Attempt to cancel or safely finish active operations.
4. Persist completed work.
5. Close Playwright resources.
6. Finalize as `cancelled`.
7. Print a summary.

A second signal may force termination after best-effort cleanup.

---

## 30. Scoring-plan confirmation

After scraping and filtering, but before new scoring requests, `jobhunter run` must display:

- Jobs discovered
- Jobs accepted
- Scores reused
- New OpenAI requests
- Skipped scoring categories
- Scoring concurrency

When new requests exist, confirmation is required.

If declined:

- No new requests are created.
- Scraped and filtered data remain.
- Reusable scores remain.
- The run completes normally.
- The summary records user-declined scoring.

`jobhunter run --yes` bypasses only this scoring confirmation.

It must not approve:

- Profiles
- Profile edits
- Configuration replacements
- Destructive actions
- Unrelated confirmations

---

## 31. CLI command surface

JobHunter must expose:

```text
jobhunter init
jobhunter paths

jobhunter configure search
jobhunter configure filters

jobhunter profile import <source-path> [second-source-path]
jobhunter profile list
jobhunter profile show [profile-id]
jobhunter profile edit <profile-id>
jobhunter profile approve <profile-id>
jobhunter profile reject <profile-id>

jobhunter run

jobhunter jobs list
jobhunter jobs show <job-id>
jobhunter jobs reevaluate

jobhunter runs list
jobhunter runs show <run-id>
```

Command aliases are not required.

All commands must:

- Validate arguments before invoking services.
- Return documented exit codes.
- Avoid state changes when validation fails.
- Write user-facing errors to stderr.
- Support `--help`.

`profile import` must accept exactly one or two supported file paths and must immediately perform source persistence, local text extraction, OpenAI profile extraction, validation, and draft creation. It must not support pasted or inline CV content.

---

## 32. CLI identifiers

SQLite entities use integer primary keys.

User-facing IDs use stable prefixes:

| Entity               | Example             |
| -------------------- | ------------------- |
| Job                  | `job_42`            |
| Pipeline run         | `run_18`            |
| Profile version      | `profile_3`         |
| Profile source       | `source_2`          |
| Search execution     | `search_7`          |
| Filter configuration | `filters_4`         |
| Extraction attempt   | `extraction_15`     |
| Scoring attempt      | `score_21`          |
| Discovery error      | `discovery_error_5` |

Rules:

- Prefixing is a CLI and presentation concern.
- SQLite relationships use integers.
- Prefixes are stable and case-sensitive.
- IDs are never reused.

### 32.1 Job identifier resolution

Commands targeting one job accept:

- Local ID, e.g. `job_42`
- Numeric LinkedIn `sourceJobId`, e.g. `123456789`

Rules:

- `job_<integer>` means local ID.
- Numeric-only means LinkedIn ID.
- Invalid formats produce exit code `2`.
- Missing jobs produce `job_not_found`.

---

## 33. `jobhunter run`

The command must:

1. Load and validate configuration.
2. Initialize and migrate the database.
3. Load the active approved profile.
4. Verify an active filter configuration.
5. Validate OpenAI credentials.
6. Create a run record.
7. Generate searches.
8. Execute searches.
9. Extract and persist jobs.
10. Filter eligible jobs.
11. Show the scoring plan.
12. Confirm scoring when needed.
13. Score accepted jobs.
14. Rank current scores.
15. Print top results.
16. Finalize the run.

### 33.1 Default output

At the end of a completed or partially completed run:

- Display the top 20 jobs by default.
- Use `output.runTopN`.
- Show all available jobs when fewer exist.
- Apply no minimum score.
- Include only jobs with current successful scores relevant to the run.
- Do not limit scraping, filtering, scoring, or persistence.

The table should include:

```text
ID | Score | Title | Company | Location | First discovered
```

---

## 34. Job listing

### 34.1 State flags

```text
--all
--scored
--accepted
--rejected
--unscored
--partial
--failed
--filter-errors
--scoring-errors
```

Only one state flag may be supplied.

Without a state flag, behavior is equivalent to `--scored`.

### 34.2 Definitions

- `--all` — all canonical jobs and applicable diagnostic records
- `--scored` — complete jobs with a current successful score
- `--accepted` — complete jobs with current accepted filter result
- `--rejected` — complete jobs with current rejected filter result
- `--unscored` — complete accepted jobs without a current successful score
- `--partial` — partial extraction records
- `--failed` — failed extraction or discovery records
- `--filter-errors` — complete jobs with current filter error
- `--scoring-errors` — eligible jobs with current scoring error

The term `matched` must not be used.

### 34.3 Refinement options

```text
--limit <number>
--min-score <number>
--company <text>
--location <text>
--run <run-id>
```

Rules:

- `--limit` must be positive.
- Default list limit: `50`.
- `--min-score` must be between `0` and `100`.
- `--min-score` applies only to states containing successful scores.
- Company and location matching are normalized and case-insensitive.
- `--run` limits to jobs discovered or evaluated in that run.

### 34.4 Default sorting

| State              | Sort                                 |
| ------------------ | ------------------------------------ |
| `--scored`         | Full-precision score descending      |
| `--accepted`       | Filtered timestamp descending        |
| `--rejected`       | Filtered timestamp descending        |
| `--unscored`       | First discovered descending          |
| `--partial`        | First discovered descending          |
| `--failed`         | Discovery/error timestamp descending |
| `--filter-errors`  | Latest filter attempt descending     |
| `--scoring-errors` | Latest scoring attempt descending    |
| `--all`            | First discovered descending          |

Canonical-job ties use `sourceJobId` ascending.

Discovery-error ties use diagnostic ID ascending.

### 34.5 Adaptive columns

#### Default and `--scored`

```text
ID | Score | Title | Company | Location | First discovered
```

#### `--accepted`

```text
ID | Title | Company | Location | Score status | Filtered at
```

#### `--rejected`

```text
ID | Title | Company | Location | Rejection reason | Filtered at
```

#### `--unscored`

```text
ID | Title | Company | Location | Scoring status | Last attempt
```

#### `--partial`

```text
ID | LinkedIn job ID | Available title | Missing fields | Error code | Discovered
```

#### `--failed`

```text
Error ID | Search query | Location | Card index | Error code | Discovered
```

#### `--filter-errors`

```text
ID | Title | Company | Error code | Last attempt
```

#### `--scoring-errors`

```text
ID | Title | Company | Error code | Attempts | Last attempt
```

#### `--all`

```text
ID | Extraction | Filter | Score status | Score | Title | Company | Location
```

### 34.6 Terminal width

Tables must:

- Read terminal width when available.
- Truncate long fields with an ellipsis.
- Preserve full stored values.
- Show full values through `jobs show`.
- Use deterministic fallback width.
- Remove lower-priority columns before making essential columns unreadable.
- Avoid horizontal overflow where practical.

---

## 35. Job and run inspection

### 35.1 `jobs show`

Must display:

- Local ID
- Source job ID
- Derived LinkedIn URL
- Title
- Company
- Location
- Description
- Extraction status
- Extraction method
- Discovery history
- Current filter result
- Rejection reasons
- Current score
- Category scores
- Explanation
- Matches
- Gaps
- Concerns
- Timestamps
- Historical-result availability

### 35.2 `runs list`

Must list recent runs with at least:

- Run ID
- Start time
- End time
- Status
- Searches attempted
- Jobs discovered
- Jobs scored
- Error summary

### 35.3 `runs show`

Must display:

- Configuration snapshot/hash
- Active profile version
- Active filter version
- Search executions
- Job counts by extraction state
- Filter counts
- Score counts
- Reused results
- Errors
- Cancellation state
- Diagnostic references

---

## 36. Machine-readable output

The following must support `--json`:

```text
jobhunter jobs list --json
jobhunter jobs show <job-id> --json
jobhunter runs list --json
jobhunter runs show <run-id> --json
jobhunter paths --json
jobhunter jobs reevaluate --dry-run --json
```

When `--json` is supplied:

- stdout contains one valid JSON document.
- No table, prompt, progress animation, or prose is written to stdout.
- Complete untruncated values are returned.
- Dates use ISO 8601.
- Errors use non-zero exit codes.
- Logs go to stderr or files.
- Every top-level response includes `schemaVersion`.

Example list shape:

```json
{
  "schemaVersion": 1,
  "state": "scored",
  "filters": {
    "minimumScore": null,
    "company": null,
    "location": null,
    "runId": null
  },
  "limit": 50,
  "returned": 1,
  "jobs": [
    {
      "id": "job_42",
      "internalId": 42,
      "sourceJobId": "123456789",
      "title": "Software Engineer",
      "company": "Example Company",
      "location": "Rotterdam",
      "overallScore": 84.5375,
      "displayScore": 84.5,
      "firstDiscoveredAt": "2026-07-30T09:00:00.000Z"
    }
  ]
}
```

Interactive commands do not need `--json`.

---

## 37. Exit codes

|  Code | Meaning                                                              |
| ----: | -------------------------------------------------------------------- |
|   `0` | Success, including completed runs with recoverable errors            |
|   `1` | Unexpected or fatal application failure                              |
|   `2` | Invalid command usage, flags, arguments, or configuration            |
|   `3` | Required approved profile or filter configuration missing            |
|   `4` | LinkedIn public access blocked or unavailable                        |
|   `5` | OpenAI authentication, permission, billing, or account-level failure |
| `130` | User cancellation through `Ctrl+C`                                   |

A run with `completed_with_errors` returns `0` when all errors were recoverable.

JSON commands must not write invalid or partial JSON to stdout when failing.

---

## 38. Run behavior and statuses

Supported run statuses:

- `running`
- `cancelling`
- `completed`
- `completed_with_errors`
- `failed`
- `cancelled`

For every discovered job:

1. Check storage.
2. Skip complete extraction.
3. Skip partial extraction.
4. Otherwise try panel extraction.
5. Try fallback when needed.
6. Persist extraction.
7. Run or reuse filtering.
8. Run or reuse scoring when accepted and confirmed.
9. Continue.

Every run must store:

- Start/end timestamps
- Final status
- Searches planned/attempted/completed
- Search errors
- Jobs discovered
- New complete jobs
- Existing complete jobs skipped
- Existing partial jobs skipped
- New partial jobs
- Failed extractions
- Jobs accepted
- Jobs rejected
- Filter errors
- Jobs scored
- Scores reused
- Scoring errors
- Scoring declined by user
- Cancellation details

---

## 39. Diagnostics

### 39.1 Default scraper artifacts

Enabled on unexpected scraper errors:

- Screenshot
- Current URL
- Error message
- Stack trace

Disabled by default:

- Playwright trace
- HTML snapshot

Example:

```json
{
  "diagnostics": {
    "onScraperError": {
      "screenshot": true,
      "currentUrl": true,
      "stackTrace": true,
      "playwrightTrace": false,
      "htmlSnapshot": false
    }
  }
}
```

Artifacts must:

- Be associated with run/search/job when possible.
- Use safe filenames.
- Preserve the original scraper error when artifact creation fails.
- Avoid intentional secret inclusion.

Retention and cleanup are outside the MVP.

---

## 40. Reliability requirements

The MVP must:

- Use bounded retries.
- Use bounded waits.
- Avoid infinite scrolling.
- Deduplicate by LinkedIn job ID.
- Isolate per-job failures.
- Preserve successful writes after later failures.
- Validate structured OpenAI output.
- Close browser resources on success and failure.
- Keep partial jobs out of filtering and scoring.
- Skip extraction for complete jobs.
- Skip automatic retries for partial jobs.
- Reuse valid filter and score results.
- Invalidate stale results.
- Preserve history.
- Write configuration atomically.
- Avoid logging secrets.
- Keep JSON stdout valid and isolated from logs.

---

## 41. Testing expectations

### 41.1 Unit tests

Must cover:

- Configuration validation
- Human-label to persisted-value mapping
- Location URL parsing
- `geoId` extraction
- Search-matrix generation
- LinkedIn URL construction
- Detail URL construction
- Job ID parsing
- Identifier resolution
- Text normalization
- Required-field validation
- Extraction-status calculation
- Keyword matching
- Alias normalization
- Seniority detection
- Language requirement detection
- Filter rule evaluation
- Filter fingerprint
- Score fingerprint
- Weighted score calculation
- Ranking and tie-breaking
- Adaptive table selection
- JSON output schemas
- Exit-code mapping

### 41.2 Integration tests

Must cover:

- Drizzle migrations
- SQLite repositories
- Foreign-key enforcement
- Profile-source persistence
- Profile versioning
- Approval and superseding
- Override behavior
- Job deduplication
- Discovery events
- Partial-job skip
- Complete-job skip
- Filter invalidation
- Score invalidation
- Reevaluation scopes
- Run finalization
- OpenAI structured-response parsing

### 41.3 Scraper tests

Must prefer saved HTML fixtures.

Live LinkedIn tests must:

- Be isolated
- Require explicit execution
- Be excluded from normal CI

---

## 42. MVP acceptance criteria

The MVP is complete when a user can:

1. Install JobHunter with the pinned runtime and package manager.
2. Run `jobhunter init`.
3. Resume interrupted initialization.
4. Configure multiple search queries interactively.
5. Paste multiple LinkedIn search URLs and extract `geoId` values.
6. Select date-posted and workplace-type values through human-readable prompts.
7. Persist valid `config.json`.
8. Import one or two supported CV files through `jobhunter profile import`.
9. Immediately perform local text extraction and OpenAI profile extraction during that command.
10. Preserve immutable source copies.
11. Reject image-only PDFs with `ocr_required`.
12. Extract a structured profile with OpenAI.
13. Merge complementary source information.
14. Surface source conflicts.
15. Edit the profile interactively.
16. Override derived values.
17. Explicitly approve the profile.
18. Configure one global filter set interactively.
19. Initialize accepted languages from the approved profile.
20. Run `jobhunter run`.
21. Generate every query/location combination.
22. Build LinkedIn URLs with `f_TPR`, `f_WT`, `geoId`, `keywords`, and `sortBy=DD`.
23. Discover jobs from public LinkedIn pages.
24. Continue until a bounded end condition.
25. Extract from the embedded panel.
26. Fall back to the dedicated job page.
27. Persist complete, partial, failed, and discovery-error outcomes.
28. Skip existing complete jobs.
29. Skip automatic retries for partial jobs.
30. Apply deterministic global filters.
31. Store explicit rejection reasons.
32. Show and confirm the OpenAI scoring plan.
33. Score one job per request with controlled concurrency.
34. Calculate the weighted score in JobHunter.
35. Reuse current filter and score results.
36. Treat changed-input results as stale.
37. Reevaluate stored jobs explicitly through all documented scopes.
38. Display the top 20 current scores after a run.
39. List jobs through explicit state flags.
40. Use adaptive width-aware tables.
41. Inspect individual jobs and runs.
42. Produce versioned JSON output for supported commands.
43. Preserve completed work after recoverable errors or cancellation.

---

## 43. Development workflow

This section defines how the MVP should be implemented. It is not part of the JobHunter runtime.

The repository may begin with only:

```text
SPEC.md
AGENTS.md
GIT.md
```

OpenCode, oh-my-opencode-slim, Superpowers, and GitNexus are optional development tools. They may be configured manually by the operator. The repository does not require custom OpenCode commands, project skills, prompt overrides, or a bundled OpenCode configuration.

### 43.1 Do not implement the complete specification in one pass

Before application code is written, divide the MVP into ordered macro tasks.

The task decomposition should be stored under:

```text
docs/tasks/INDEX.md
docs/tasks/TASK-001-<slug>.md
docs/tasks/TASK-002-<slug>.md
...
```

Creating these files is a planning step. It must not also create application code, install dependencies, generate migrations, or begin Task 001.

The decomposition must separate at least these areas:

1. Repository and TypeScript foundation
2. Paths, operational configuration, validation, and logging
3. SQLite, Drizzle, migrations, repositories, and identifiers
4. Guided initialization
5. CV file import and local text extraction
6. OpenAI profile extraction
7. Profile review, editing, conflicts, approval, and overrides
8. Search configuration and LinkedIn URL generation
9. Global deterministic filters
10. LinkedIn result discovery and result loading
11. Job-detail extraction and persistence
12. OpenAI scoring and deterministic ranking
13. Pipeline orchestration, confirmation, concurrency, and cancellation
14. Job and run inspection, tables, and JSON output
15. Explicit reevaluation
16. Diagnostics, integration testing, and MVP acceptance verification

A task may be split further when necessary. Several of these areas must not be combined into one oversized implementation task.

### 43.2 Plan one task at a time

Before implementing a task:

1. Read the task document and only the relevant sections of `SPEC.md`.
2. Inspect completed dependencies and the current repository.
3. Write a detailed plan for that task.
4. Divide the plan into ordered, testable sub-tasks.
5. Define expected files, tests, verification commands, risks, and open questions.
6. Stop and request approval.

A plan for one task does not approve another task.

### 43.3 Implement one approved task at a time

After approval:

1. Work only within the selected task.
2. Follow its approved sub-task order.
3. Add tests with the implementation.
4. Run the task's verification commands.
5. Update its task document and `docs/tasks/INDEX.md`.
6. Report changed files, test results, limitations, and remaining questions.
7. Stop before starting the next task.

The implementation must not add speculative work belonging to future tasks.

### 43.4 Review before completion

A task should be reviewed against:

- Its approved plan
- Its referenced `SPEC.md` requirements
- Its tests and verification results
- Architecture and dependency boundaries
- Error and cancellation behavior
- Database and migration safety, when applicable
- Documentation alignment
- Accidental implementation of future-task scope

Review findings should be resolved or explicitly deferred before the task is marked complete.

### 43.5 Development tools

When available:

- oh-my-opencode-slim may delegate bounded work inside the selected task.
- Superpowers may be used for planning, TDD, debugging, review, worktrees, and branch completion.
- GitNexus may be used after source code exists to inspect architecture, symbol context, and change impact.

These tools support the workflow. They do not replace task approval, tests, or the product specification.

GitNexus indexes and other local agent state must not be committed.

### 43.6 Context and token discipline

Each OpenCode session should focus on one operation:

- Decomposing the MVP
- Planning one task
- Implementing one approved task
- Reviewing one task

After the initial decomposition:

- Read only the specification sections needed for the selected task.
- Give subagents only the context needed for their assigned sub-task.
- Do not ask an agent to implement the complete specification.
- Do not ask it to continue through all remaining tasks.
- Prefer a fresh session for the next macro task.

### 43.7 Source-of-truth order

Use this order when instructions conflict:

1. `SPEC.md`
2. Explicit user decisions made after the specification
3. The approved plan for the selected task
4. `AGENTS.md`
5. `GIT.md`
6. Existing implementation patterns
7. Development-tool output

Implementation plans and tool output may clarify technical details. They must not silently change or weaken approved product behavior.

---

## 44. Open implementation decisions

The following implementation-level decisions may be resolved during the relevant task plan. Any choice that changes product behavior or weakens an acceptance criterion requires user approval:

1. Exact prompt-library interaction design for multiline profile fields
2. Exact profile-extraction prompt contents and prompt versioning strategy
3. Exact job-scoring prompt contents
4. Exact deterministic alias dictionary
5. Exact seniority phrase dictionary
6. Exact spoken-language phrase dictionary
7. Exact database tables, indexes, and constraints
8. Exact Drizzle migration commands and release workflow
9. Exact package versions beyond the pinned runtime and package manager
10. Exact live LinkedIn test strategy
11. Whether raw job HTML is ever persisted
12. Exact terminal table library
13. Exact application versioning and release strategy
14. Exact OpenAI SDK integration details

The following remain explicitly outside the MVP unless this specification is amended:

- Pasted or inline CV input
- Manual retry of partial jobs
- Profile-source cleanup
- Diagnostic retention or cleanup automation

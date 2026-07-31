# TASK-006 — Search Configuration Workflow and LinkedIn URL Generation

**Status:** Planned; not approved for implementation
**Order:** 006
**Dependencies:** TASK-002, TASK-004

## Scope

Implement the interactive search settings and pure URL-generation domain:

- Validate and normalize one or more search queries with deterministic order, whitespace normalization, and case-insensitive deduplication.
- Validate and deduplicate locations by non-empty LinkedIn `geoId` while preserving display names.
- Parse supported public LinkedIn jobs-search URLs, validate hostname/path, extract `geoId`, and request a label when it cannot be inferred reliably.
- Support only the specified date-posted and workplace-type values.
- Keep search settings in the owned `config.json` section and update them atomically through the configuration service.
- Generate the Cartesian product of all queries and locations.
- Build parameter-aware LinkedIn URLs with `f_TPR`, `f_WT`, `geoId`, `keywords`, and mandatory `sortBy=DD`.
- Define search-execution input records for later persistence and pipeline use.

LinkedIn browser access and scraping are out of scope.

## Dependencies and handoffs

- Consumes configuration loading/owned-section update contracts from TASK-002.
- Consumes repository and identifier contracts from TASK-004.
- Produces validated search configuration, URL parser/builder, matrix generator, and prompt/service separation for TASK-011, TASK-012, and TASK-015.

## Referenced specification sections

- `SPEC.md` §5.3 CLI and prompting
- `SPEC.md` §8.5 Configuration updates
- `SPEC.md` §10.1–10.9 Search configuration and location URL parsing
- `SPEC.md` §11.1–11.4 Search matrix, URL mapping, construction, and persistence inputs
- `SPEC.md` §31 CLI command surface
- `SPEC.md` §41.1 unit-test expectations

## Expected tests

- Normalize, validate, deduplicate, and order queries and locations.
- Map date-posted labels and workplace labels to exact persisted values.
- Parse supported and reject malformed, unsupported, wrong-hostname, and missing-`geoId` URLs.
- Generate every query/location pair exactly once.
- Verify URL parameters are independently encoded and `sortBy=DD` is always present.
- Verify interactive prompts are separate from the application service and can be tested with fake answers.
- Verify configuration preview/confirmation is required before replacing existing search settings.

## Verification requirements

- Run pure domain tests for normalization, parsing, matrix generation, and URL construction.
- Run prompt/service tests without a real terminal.
- Run a CLI smoke test for valid and invalid search configuration input.
- Review generated URLs against the exact parameter table in `SPEC.md` §11.2.
- Run typecheck and focused tests.

## Completion criteria

- `jobhunter configure search` can produce a valid normalized persisted search configuration without manual JSON editing.
- The matrix count equals `searchQueries.length × locations.length`.
- URL generation is deterministic and parameter-aware.
- Unsupported LinkedIn filters and plain-text location resolution are not introduced.

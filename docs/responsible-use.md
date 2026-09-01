# Responsible use

JobHunter is a local CLI that helps one job seeker discover public job
listings on LinkedIn. This document describes what JobHunter does, what
it deliberately does not do, and the rules you agree to when you run it.

## What JobHunter does

- Reads **public, unauthenticated** LinkedIn job-search pages.
- Scrapes sequentially with bounded timeouts and retries.
- Stores everything locally in your operating-system-specific data
  directory (run `jobhunter paths` to see the location).
- Never stores, prompts for, or transmits credentials.
- Never logs in or reuses an authenticated session.
- Extracts data from the public search-results page and, where needed,
  the public dedicated job page (no authentication required).
- Applies your local, deterministic filters and scores accepted jobs
  with OpenAI using the profile you explicitly approved.

## What JobHunter does NOT do

- Does not bypass LinkedIn rate limits, CAPTCHAs, or access controls.
- Does not access authenticated content or any feature behind a login.
- Does not perform automated job applications.
- Does not redistribute scraped data as a dataset.
- Does not run in the background on a schedule — the MVP is manually
  triggered.
- Does not call OpenAI for filtering (only for explicit profile
  extraction and scoring, with your approval at each step).

## Your responsibilities

When you run JobHunter you agree to:

1. Comply with [LinkedIn's User Agreement](https://www.linkedin.com/legal/user-agreement)
   and [LinkedIn's robots.txt](https://www.linkedin.com/robots.txt).
2. Use JobHunter only for **personal, lawful job-search purposes**.
3. Honor LinkedIn's rate limits; the scraper is sequential and bounded
   but you must not parallelize, proxy-farm, or otherwise amplify it.
4. Stop using JobHunter immediately if you receive a cease-and-desist
   or other legal notice from LinkedIn or Microsoft.
5. Do not use JobHunter to build a commercial dataset, train another
   model on scraped LinkedIn content, or compete with LinkedIn.

## Reporting concerns

If you see misuse of JobHunter, or you want to suggest an improvement
to this policy, open a
[Responsible-use issue](https://github.com/leuri17/jobhunter/issues/new?template=responsible-use-concern.yml).

For security vulnerabilities, follow [`SECURITY.md`](../SECURITY.md) instead.

## Trademark notice

"LinkedIn" is a trademark of Microsoft Corporation. JobHunter is an
independent open-source project and is not affiliated with, endorsed by,
or sponsored by LinkedIn or Microsoft.

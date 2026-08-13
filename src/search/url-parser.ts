import { LinkedInURLParseError } from './errors.js';

export interface ParsedLinkedInSearchURL {
  readonly geoId: string;
  readonly originalURL: string;
  readonly hostname: 'www.linkedin.com';
}

const ALLOWED_HOSTNAME = 'www.linkedin.com';
const REQUIRED_PATHNAME = '/jobs/search/';

function fail(raw: string, reason: string): never {
  throw new LinkedInURLParseError(raw, reason);
}

export function parseLinkedInJobsSearchURL(raw: string): ParsedLinkedInSearchURL {
  if (typeof raw !== 'string') {
    fail(String(raw), 'URL must be a string.');
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    fail(raw, 'URL must be a non-empty string.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    fail(raw, 'URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    fail(raw, `Only the "https:" scheme is supported (got "${url.protocol}").`);
  }
  if (url.hostname !== ALLOWED_HOSTNAME) {
    fail(raw, `Hostname must be "${ALLOWED_HOSTNAME}" (got "${url.hostname}").`);
  }
  if (url.pathname !== REQUIRED_PATHNAME) {
    fail(raw, `Path must be "${REQUIRED_PATHNAME}" (got "${url.pathname}").`);
  }
  const geoId = url.searchParams.get('geoId');
  if (geoId === null) {
    fail(raw, 'Missing required "geoId" query parameter.');
  }
  const trimmedGeoId = geoId.trim();
  if (trimmedGeoId === '') {
    fail(raw, '"geoId" must be a non-empty value.');
  }
  return {
    geoId: trimmedGeoId,
    originalURL: trimmed,
    hostname: ALLOWED_HOSTNAME,
  };
}

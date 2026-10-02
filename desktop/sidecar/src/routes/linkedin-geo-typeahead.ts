import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApplicationError, ExitCode, ValidationError } from '@jobhunter/core/errors';

/**
 * One LinkedIn typeahead hit. We only forward entries of type GEO;
 * the picker is keyed on displayName + geoId and ignores other shapes.
 */
const GeoHitSchema = z.object({
  id: z.string().min(1),
  type: z.literal('GEO'),
  displayName: z.string().min(1),
  trackingId: z.string().optional(),
});

/**
 * Loose envelope around the raw LinkedIn response. We accept unknown shapes
 * so a future LinkedIn payload change doesn't 500 the picker; we filter down
 * to well-formed GEO entries below.
 */
const RawResponseSchema = z.array(z.record(z.string(), z.unknown()));

const TYPEAHEAD_URL =
  'https://www.linkedin.com/jobs-guest/api/typeaheadHits' +
  '?typeaheadType=GEO' +
  '&geoTypes=POPULATED_PLACE,ADMIN_DIVISION_2,MARKET_AREA,COUNTRY_REGION';

// Stable, recent Chrome UA. LinkedIn throttles empty / non-browser UAs.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 8000;

class UpstreamError extends ApplicationError {
  constructor(code: string, message: string, metadata: Record<string, unknown> = {}) {
    super(code, message, ExitCode.OpenAIFailure, metadata);
  }
}

// Tiny in-process cache. The UI debounces 250ms; this keeps the
// upstream hop cheap when the user keeps typing the same prefix.
const CACHE_TTL_MS = 5000;
const CACHE_MAX_ENTRIES = 50;
const cache = new Map<string, { hits: Array<z.infer<typeof GeoHitSchema>>; expiresAt: number }>();

function cacheGet(key: string): Array<z.infer<typeof GeoHitSchema>> | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.hits;
}

function cacheSet(key: string, hits: Array<z.infer<typeof GeoHitSchema>>): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { hits, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Test-only: clear the in-process typeahead cache. Not part of the public
 * API; imported by the handler test so each case starts with a clean slate.
 */
export function __resetGeoTypeaheadCacheForTesting(): void {
  cache.clear();
}

async function fetchGeoHits(q: string): Promise<Array<z.infer<typeof GeoHitSchema>>> {
  const url = `${TYPEAHEAD_URL}&query=${encodeURIComponent(q)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    throw new UpstreamError(
      isAbort ? 'upstream_timeout' : 'upstream_request_error',
      isAbort ? 'Upstream request timed out.' : 'Upstream request failed.',
      { cause: err instanceof Error ? err.message : String(err) },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new UpstreamError('upstream_http_error', `Upstream returned HTTP ${res.status}.`, {
      status: res.status,
    });
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    throw new UpstreamError('upstream_parse_error', 'Upstream response was not valid JSON.', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }

  const parsed = RawResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError('upstream_parse_error', 'Upstream response was not a JSON array.', {});
  }

  const hits: Array<z.infer<typeof GeoHitSchema>> = [];
  for (const entry of parsed.data) {
    const candidate = GeoHitSchema.safeParse(entry);
    if (candidate.success) hits.push(candidate.data);
  }
  return hits;
}

export async function registerLinkedinGeoTypeaheadRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>('/api/linkedin/geo-typeahead', async (req, reply) => {
    const raw = req.query.q;
    const q = typeof raw === 'string' ? raw.trim() : '';
    if (q.length === 0) {
      throw new ValidationError(
        'missing_query',
        'Query parameter "q" is required and must be non-empty.',
      );
    }

    const cached = cacheGet(q);
    if (cached !== undefined) {
      return { schemaVersion: 1, hits: cached };
    }

    const hits = await fetchGeoHits(q);
    cacheSet(q, hits);
    void reply;
    return { schemaVersion: 1, hits };
  });
}

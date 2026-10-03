export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Please sign in.');
export const forbidden = (msg = 'Not allowed.') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: HttpError): Response {
  return json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
}

const MAX_JSON_BYTES = 64 * 1024;

export async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw badRequest('Expected a JSON body.');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_JSON_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Malformed JSON.');
  }
}

/** Parses `?limit=` with a default of 20 and a hard cap of 50. */
export function pageLimit(url: URL, def = 20, max = 50): number {
  const n = Number(url.searchParams.get('limit') ?? def);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

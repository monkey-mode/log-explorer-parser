interface ExtState {
  baseUrl: string;
  indexPattern: string | null;
  indexPatternId: string | null;
  timeFrom: string;
  timeTo: string;
  containers: string[];
  hits: unknown[];
  ts: number;
}

// In-memory store — single user localhost tool, resets on server restart
let stored: ExtState | null = null;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ExtState>;
  if (!Array.isArray(body.hits)) return Response.json({ error: 'hits array required' }, { status: 400, headers: CORS });
  stored = {
    baseUrl:        body.baseUrl        ?? '',
    indexPattern:   body.indexPattern   ?? null,
    indexPatternId: body.indexPatternId ?? null,
    timeFrom:       body.timeFrom       ?? 'now-1h',
    timeTo:         body.timeTo         ?? 'now',
    containers:     body.containers     ?? [],
    hits:           body.hits,
    ts: Date.now(),
  };
  return Response.json({ ok: true }, { headers: CORS });
}

export async function GET() {
  // Expire after 30 minutes
  if (!stored || Date.now() - stored.ts > 30 * 60 * 1000) {
    return Response.json({ cookie: null }, { headers: CORS });
  }
  return Response.json(stored, { headers: CORS });
}

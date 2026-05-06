export async function POST(request: Request) {
  try {
    const { url, body, cookie } = (await request.json()) as {
      url: string;
      body: unknown;
      cookie: string;
    };

    if (!url || !cookie) {
      return Response.json({ error: 'url and cookie are required' }, { status: 400 });
    }

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'osd-xsrf': 'osd-fetch',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });

    const ct = upstream.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await upstream.text();
      const preview = text.slice(0, 200).replace(/\s+/g, ' ').trim();
      return Response.json(
        { error: `OSD returned non-JSON (${upstream.status}): ${preview}` },
        { status: 502 },
      );
    }
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

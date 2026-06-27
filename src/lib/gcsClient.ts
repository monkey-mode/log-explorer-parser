// Client-side Cloud Storage access using the signed-in user's own Google account.
// Auth: Google Identity Services (GIS) token flow → OAuth access token with the
// devstorage.read_only scope. Reads call the GCS JSON API directly from the
// browser; Google returns per-origin CORS headers for authenticated requests, so
// no bucket CORS config is required.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
// devstorage.read_only → read buckets/objects; cloud-platform.read-only → list projects.
const SCOPE =
  'https://www.googleapis.com/auth/devstorage.read_only ' +
  'https://www.googleapis.com/auth/cloud-platform.read-only';
const API = 'https://storage.googleapis.com/storage/v1/b';
const CRM_API = 'https://cloudresourcemanager.googleapis.com/v1/projects';

// Only buckets whose name ends with this suffix are offered for selection.
export const BUCKET_SUFFIX = 'k8s_container_logs';

// Optional defaults used to pre-select the project/bucket pickers.
export const DEFAULT_BUCKET = process.env.NEXT_PUBLIC_GCS_LOG_BUCKET || '';
export const DEFAULT_PROJECT = process.env.NEXT_PUBLIC_GCS_PROJECT || '';

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

// Refuse to download a single object larger than this into the browser (50 MB).
export const MAX_OBJECT_BYTES = 50 * 1024 * 1024;

export interface GcsObject {
  name: string;
  size: number;
  updated: string;
  generation: string;
}

export interface GcsProject {
  projectId: string;
  name: string;
}

// ── Google Identity Services types (minimal) ───────────────────────────────
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export interface AccessToken {
  token: string;
  expiresAt: number; // epoch ms
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
}
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => TokenClient;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let gisPromise: Promise<GoogleOAuth2> | null = null;

/** Inject the GIS script once and resolve when google.accounts.oauth2 is ready. */
export function loadGis(): Promise<GoogleOAuth2> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const ready = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('Google Identity Services failed to initialize.'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      if (window.google?.accounts?.oauth2) ready();
      else existing.addEventListener('load', ready, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = ready;
    s.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Prompt Google sign-in and resolve with an access token + its expiry. */
export async function requestAccessToken(clientId: string): Promise<AccessToken> {
  if (!clientId) throw new Error('Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID.');
  const oauth2 = await loadGis();
  return new Promise<AccessToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) {
          // expires_in is seconds; shave 60s as a safety margin.
          const ttl = (resp.expires_in ?? 3600) - 60;
          resolve({ token: resp.access_token, expiresAt: Date.now() + ttl * 1000 });
        } else {
          reject(new Error(resp.error_description || resp.error || 'Sign-in failed.'));
        }
      },
      error_callback: (err) => reject(new Error(err.message || err.type || 'Sign-in was cancelled.')),
    });
    client.requestAccessToken();
  });
}

// ── GCS REST helpers ────────────────────────────────────────────────────────

async function throwForStatus(res: Response): Promise<never> {
  if (res.status === 401) throw new Error('Session expired — sign in again.');
  if (res.status === 403) throw new Error('Access denied — your account cannot read this.');
  if (res.status === 404) throw new Error('Not found.');
  let detail = '';
  try { detail = (await res.json())?.error?.message ?? ''; } catch { /* ignore */ }
  throw new Error(`GCS request failed (${res.status})${detail ? `: ${detail}` : ''}`);
}

async function gcsFetch(token: string, url: string, asText = false) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) await throwForStatus(res);
  return asText ? res.text() : res.json();
}

interface ListResponse {
  prefixes?: string[];
  items?: { name: string; size?: string; updated?: string; generation?: string }[];
}

/** List the user's active projects (Cloud Resource Manager). */
export async function listProjects(token: string): Promise<GcsProject[]> {
  const projects: GcsProject[] = [];
  let pageToken = '';
  // Cap pages so a huge org can't loop forever.
  for (let page = 0; page < 20; page++) {
    const url = `${CRM_API}?filter=${encodeURIComponent('lifecycleState:ACTIVE')}&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = (await gcsFetch(token, url)) as {
      projects?: { projectId: string; name?: string }[];
      nextPageToken?: string;
    };
    for (const p of data.projects ?? []) {
      projects.push({ projectId: p.projectId, name: p.name || p.projectId });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

/** List buckets in a project, keeping only those ending with BUCKET_SUFFIX. */
export async function listBuckets(token: string, projectId: string): Promise<string[]> {
  const names: string[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const url = `${API}?project=${encodeURIComponent(projectId)}&maxResults=1000&fields=items(name),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = (await gcsFetch(token, url)) as { items?: { name: string }[]; nextPageToken?: string };
    for (const b of data.items ?? []) names.push(b.name);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return names.filter((n) => n.endsWith(BUCKET_SUFFIX)).sort();
}

/** List immediate sub-"folders" under `prefix` (delimiter-based). */
export async function listPrefixes(token: string, bucket: string, prefix: string): Promise<string[]> {
  const url =
    `${API}/${bucket}/o?delimiter=${encodeURIComponent('/')}` +
    `&prefix=${encodeURIComponent(prefix)}&maxResults=1000`;
  const data = (await gcsFetch(token, url)) as ListResponse;
  return (data.prefixes ?? []).sort();
}

/** List the objects (files) directly under `prefix`. */
export async function listObjects(token: string, bucket: string, prefix: string): Promise<GcsObject[]> {
  const url =
    `${API}/${bucket}/o?delimiter=${encodeURIComponent('/')}` +
    `&prefix=${encodeURIComponent(prefix)}&maxResults=1000` +
    `&fields=${encodeURIComponent('items(name,size,updated,generation),prefixes')}`;
  const data = (await gcsFetch(token, url)) as ListResponse;
  return (data.items ?? [])
    .filter((o) => o.name !== prefix && !o.name.endsWith('/'))
    .map((o) => ({ name: o.name, size: Number(o.size ?? 0), updated: o.updated ?? '', generation: o.generation ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Download a single object's contents as text, guarding against oversized files
 * and reporting streaming progress via `onProgress(received, total)`.
 * Pass `knownSize` (from a prior listing) to skip the extra metadata round-trip;
 * when omitted, the size is fetched first as a safety net.
 */
export async function downloadObject(
  token: string,
  bucket: string,
  name: string,
  knownSize?: number,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  let size = knownSize;
  if (size === undefined) {
    const metaUrl = `${API}/${bucket}/o/${encodeURIComponent(name)}?fields=size`;
    const meta = (await gcsFetch(token, metaUrl)) as { size?: string };
    size = Number(meta.size ?? 0);
  }
  if (size > MAX_OBJECT_BYTES) {
    throw new Error(
      `"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB, over the ` +
        `${MAX_OBJECT_BYTES / 1024 / 1024} MB limit.`
    );
  }

  const url = `${API}/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) await throwForStatus(res);

  const total = Number(res.headers.get('Content-Length')) || size || 0;

  // Fall back to a non-streamed read if the stream isn't available.
  if (!res.body) {
    const text = await res.text();
    onProgress?.(total || text.length, total || text.length);
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
  return new TextDecoder('utf-8').decode(buf);
}

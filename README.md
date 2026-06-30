# Log Explorer

A GCP Logs Explorer-style viewer for OpenSearch CSV exports. Built to make it easy to investigate logs when your DevOps team migrates GCP structured logs into OpenSearch and exports them with `json_payload` grouped into a single CSV column.

## The Problem

OpenSearch exports logs as CSV with this structure:

| `@timestamp` | `kubernetes.container_name` | `json_payload` | `text_payload` |
|---|---|---|---|
| Apr 11, 2026 @ 17:30:51 | orch-payment-transaction | `{ "message": "...", "severity": "ERROR", ... }` | |
| Apr 11, 2026 @ 17:30:52 | orch-payment-transaction | `-` | `plain log line from stdout` |

The `json_payload` column is a multiline JSON blob — impossible to read in a spreadsheet and hard to filter in a text editor.

## Features

- **Severity filter** — quickly isolate ERROR / WARN / INFO / DEBUG entries
- **Full-text search** — searches across message, error, URL, caller, correlation ID, and the entire JSON payload
- **Service filter** — filter to a specific `kubernetes.container_name`
- **Correlation ID trace** — click any log row's "Filter by Corr-ID" button to show all logs in the same request trace
- **Inline JSON tree** — click any row to expand a collapsible JSON tree viewer; nested JSON strings (e.g. `http_response_body`) are auto-parsed and rendered as trees
- **Stack trace panel** — ERROR logs with a `stacktrace` field get a dedicated highlighted block
- **HTTP summary** — request logs show `METHOD /path [status] latency` in the row summary
- **Copy buttons** — copy Correlation ID or the full JSON payload with one click
- **Drag & drop** — drop a CSV file anywhere on the page to load it
- **Keyboard shortcuts** — `/` to focus search, `Esc` to clear Correlation ID filter

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then load your OpenSearch CSV export via the **Load CSV** button or drag & drop.

## GCS bucket viewer (`/gcs`)

When logs are routed to a Cloud Storage bucket via a **Cloud Logging → GCS sink** (instead of OpenSearch), use the GCS viewer at [http://localhost:3000/gcs](http://localhost:3000/gcs). It runs **entirely in the browser**: you **sign in with your own Google account**, then **choose a project and bucket** and read it directly via the Cloud Storage JSON API with your own IAM permissions — no server, no service-account key, no shared credentials. Handy when you only have **read/download** access and can't use GCP Log Explorer.

After sign-in you pick a **project** (from the projects you can access) and a **bucket** — the bucket dropdown only lists buckets whose name ends with `k8s_container_logs`. Each bucket is organized as `<logId>/YYYY/MM/DD/<hourly>.json`, where each object is newline-delimited Cloud Logging `LogEntry` JSON (top-level folders like `stdout/`, `stderr/`). You can then filter by **severity**, **service** (searchable multi-select), a **time range** (relative "last N min/hours" or an absolute from/to), full-text search, and correlation ID. Files over **50 MB** are skipped to keep the browser responsive.

### One-time setup: create an OAuth Client ID

You need a public OAuth 2.0 **Client ID** so the browser can sign you in. In the [GCP Console](https://console.cloud.google.com/) for the project that owns the bucket:

1. **APIs & Services → OAuth consent screen** — choose **Internal** if your account is in the same Google Workspace org as the project (simplest); otherwise choose **External** and add your email under **Test users**. Set an app name + support email, Save.
2. **APIs & Services → Library** — enable both **Cloud Storage API** (read buckets/objects) and **Cloud Resource Manager API** (list your projects).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** — Application type **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost:3000` (add your deployed origin later too). No redirect URI is needed. Click **Create**.
5. Copy the **Client ID** (looks like `…apps.googleusercontent.com`).

> The Client ID is public and safe to ship. There is **no client secret** — this app uses the browser token flow.

### Run

```bash
cp .env.local.example .env.local
# then edit .env.local:
#   NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your client id>.apps.googleusercontent.com
#   NEXT_PUBLIC_GCS_PROJECT=<project to pre-select>          # optional
#   NEXT_PUBLIC_GCS_LOG_BUCKET=<bucket to pre-select>        # optional

npm install
npm run dev
```

Open [`/gcs`](http://localhost:3000/gcs), click **Sign in with Google**, choose a **project** and **bucket**, then pick a log (e.g. `stdout`) and a date, click **List files**, and load one (or **Load all** for the day).

> Notes:
> - The token requests the `devstorage.read_only` and `cloud-platform.read-only` scopes (the latter is needed to list your projects). Access to any project/bucket/object is still enforced by your own IAM.
> - Your sign-in token is kept in `sessionStorage` so a page refresh keeps you signed in; it clears when you close the tab and expires after ~1 hour (then sign in again). Nothing is stored server-side.
> - Only buckets whose name ends with `k8s_container_logs` are shown in the bucket picker.
> - Files over the size cap (default 50 MB, set via `NEXT_PUBLIC_GCS_MAX_FILE_MB`; use `0` to disable) are skipped on load to keep the browser responsive.
> - Downloads show per-file and overall progress, and each loaded object is cached locally in **IndexedDB** (keyed by bucket + object + generation) so reloading it is instant and offline. Use **Clear cache** in the file bar to purge it; nothing is written to your filesystem.
> - Sink files are written in hourly batches, so the most recent entries may lag by up to an hour — this is browse/near-real-time, not a true live tail.

## CSV Format

Export from OpenSearch with these columns (in this order):

```
@timestamp, kubernetes.container_name, json_payload, text_payload
```

The parser handles multiline `json_payload` fields correctly — no pre-processing needed.

When `json_payload` is `-` or blank (e.g. plain stdout/stderr lines), the parser falls back to `text_payload` and surfaces it as the log message. The `text_payload` column is optional — rows with only 3 columns are still accepted.

## Browser Extension (live mode)

The [`extension/`](extension/) folder contains a Chrome side-panel extension that skips the CSV export entirely. It captures the OpenSearch Dashboards search response (`opensearch-with-long-numerals`) live and renders it with the same explorer UI.

- **No file needed** — run a search in OSD and results stream into the side panel
- **Single `_source` field** — parses each hit's `_source`, preferring `json_payload` and falling back to `text_payload`
- **Tab-scoped** — the panel is enabled only on the OSD origin and reads only its own tab's data, so it never follows you to unrelated tabs
- **No build step** — load the folder directly via `chrome://extensions` → **Load unpacked**

See [extension/README.md](extension/README.md) for loading instructions and how to point it at a different OSD host.

## Project Structure

```
src/
├── app/
│   ├── page.tsx          # Entry point
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── LogExplorer.tsx   # Main shell: state, filters, file loading
│   ├── LogRow.tsx        # Individual log row + expandable detail panel
│   └── JsonViewer.tsx    # Recursive collapsible JSON tree renderer
└── lib/
    ├── csvParser.ts      # RFC 4180 CSV parser + log entry parser
    ├── osParser.ts       # OpenSearch response parser (_source → log entry)
    └── logTypes.ts       # TypeScript types

extension/                # Chrome side-panel extension (live OSD capture)
├── manifest.json         # MV3 config
├── interceptor.js        # MAIN world: patches fetch/XHR to capture the search response
├── relay.js              # ISOLATED world: forwards captured JSON to the background
├── background.js         # Service worker: per-tab storage + side-panel scoping
├── parser.js             # _source → log entry (port of osParser.ts)
└── sidepanel.{html,css,js} # The explorer UI
```

## Tech Stack

- [Next.js 16](https://nextjs.org) (App Router)
- [Tailwind CSS v4](https://tailwindcss.com)
- TypeScript

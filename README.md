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

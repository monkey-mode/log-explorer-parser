# OSD Log Explorer (Chrome Extension)

A side-panel log viewer that reads logs **live** from the OpenSearch Dashboards
search API instead of a CSV/JSON file. It captures the response of the
`opensearch-with-long-numerals` request that OSD makes when you run a search,
parses each hit's `_source` (which carries either `json_payload` or
`text_payload`), and renders it with the same explorer UI as the web app.

## Load it

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** and select this `extension/` folder

## Use it

1. Open OpenSearch Dashboards at `https://logging-nonprd.gcp.ktbapp.tech`
2. Click the extension's toolbar icon to open the side panel
3. Run/refresh a search in Discover — results stream into the panel automatically

The connection dot turns **green** once results are received.

## How it works

| File | World | Role |
|---|---|---|
| `interceptor.js` | MAIN | Patches `fetch`/`XHR`, captures the search response |
| `relay.js` | ISOLATED | Forwards the captured JSON to the background |
| `background.js` | service worker | Stores data per-tab, scopes the side panel to OSD tabs |
| `parser.js` | side panel | Parses `rawResponse.hits.hits[]._source` → log entries |
| `sidepanel.{html,css,js}` | side panel | The explorer UI |

### Tab scoping

There is **no global side panel** (the manifest deliberately omits
`side_panel.default_path`). At startup the panel is disabled globally, then
**enabled only on OSD tabs** (`logging-nonprd.gcp.ktbapp.tech`) via per-tab
`chrome.sidePanel.setOptions`. This is what stops the panel from "following" you
to unrelated tabs — a global panel persists window-wide once opened, but a
per-tab panel is closed by Chrome when you switch to a tab where it's disabled.
Captured data is keyed by tab id, and the panel only ever reads its own tab's
data.

> After updating the extension, reload it from `chrome://extensions` and reopen
> the panel so the new (non-global) configuration takes effect.

## Pointing at another OSD host

The host appears in three places — update all of them:

- `manifest.json` → `host_permissions` and both `content_scripts[].matches`
- `background.js` → `OSD_HOST`
- `sidepanel.js` → `OSD_HOST`

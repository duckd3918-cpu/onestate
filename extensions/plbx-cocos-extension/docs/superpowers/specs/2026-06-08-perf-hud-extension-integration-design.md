# Perf HUD — Extension Preview Integration — Design Spec

**Date:** 2026-06-08
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/playable-perf-test`
**Builds on:** `docs/superpowers/specs/2026-06-08-playable-perf-test-design.md` (the CLI perf tool)

## Problem

The CLI perf tool (`npm run perf`) profiles a playable in a headed Playwright Chromium with the
in-page HUD. We want the same live HUD inside the extension's normal workflow: when the developer
opens the preview/validator (panel → `startPreview` → `shell.openExternal(/preview/{network})`),
a HUD should overlay the creative, measure FPS/frame-time/memory live, and on demand produce the
same JSON+HTML performance report — **without** Playwright (the preview opens in the developer's own
external browser).

## Goals

1. The perf HUD overlays the creative in the existing `/preview/{network}` flow (external browser).
2. Live HUD: FPS / frame-time / memory + sparkline, spikes flash red, `M` markers, `P` toggle (default on).
3. A "Stop & Report" action POSTs the session to the preview server, which writes a JSON+HTML report
   (reusing `analyze.ts` + `report.ts`) and opens it in a new tab.
4. Reuse the CLI core unchanged where possible; the HUD source serves BOTH the CLI (Playwright
   `__perfEmit` streaming) and the browser (local buffer + POST).

## Non-Goals

- No automatic CPU/network throttle in this path (no Playwright/CDP in the external browser). Low-end
  emulation is manual via the developer's DevTools (CPU 6x). The report documents this.
- No panel UI changes (no new checkbox/setting). Control lives in the in-page HUD.
- No bundling of Playwright/Chromium into the extension (this path doesn't use them).

## Architecture

Reused unchanged: `src/core/perf/analyze.ts`, `src/core/perf/report.ts`, `src/core/perf/types.ts`.
Modified: `src/core/perf/hud-source.ts` (dual-mode), `src/core/preview/sdk-mocks.ts`
(`generatePreviewUtil` appends the HUD + config), `src/core/preview/server.ts` (two new routes).

Existing wiring (confirmed):
- `generatePreviewUtil({ networkId, mraid, ... }): string` (sdk-mocks.ts:30) builds the injected
  script; `injectPreviewUtil(html, utilScript)` (server.ts:150) inserts it into `<head>`.
- Route `GET /preview/{networkId}` (server.ts:716) builds the util (line 741) and injects it (747).
  `networkId` and the server's `outputDir` closure variable are in scope there.

## Components

### 1. `hud-source.ts` — dual-mode (modify)

The HUD always maintains in-page buffers (`samples`, `spikes`, `markers`) plus `loadToFirstFrameMs`
and `timeToGameReadyMs`. Transport branches on `window.__perfEmit`:

- **CLI mode** (`window.__perfEmit` present): stream each event via `__perfEmit` (unchanged
  behavior); no Stop button.
- **Browser mode** (`__perfEmit` absent): buffer only; render a fixed "⏺ Stop & Report" button
  (bottom-right, distinct from the top-right metrics box). On click → build a `SessionResult`-shaped
  JSON `{ network, samples, spikes, markers, loadToFirstFrameMs, timeToGameReadyMs }` and
  `fetch(reportEndpoint, { method:'POST', body: JSON.stringify(...) })`. On `{reportUrl}` →
  `window.open(reportUrl, '_blank')`. On fetch failure (server down / non-200) → fall back to a
  client-side download of the raw session JSON (Blob + `<a download="perf-<network>.json">`) and
  show an inline error line in the HUD. (HTML rendering stays server-side via report.ts; the
  fallback only preserves the captured data, it does not re-render the HTML client-side.)

Config read from `window.__plbxPerfConfig`: `{ spikeThresholdMs, network, reportEndpoint }`
(browser mode); CLI mode sets only `spikeThresholdMs` (network/endpoint absent → buffer+POST UI is
shown only when `reportEndpoint` is present, so the CLI never shows the Stop button).

Unchanged HUD behavior: top-frame-only guard, `gameReady` wrap (not overwrite), spike flash, `M`/`P`
keys, warmup instantaneous FPS, performance.memory sampling.

### 2. `sdk-mocks.ts` `generatePreviewUtil` (modify)

Append to the returned script:
- `window.__plbxPerfConfig = { spikeThresholdMs: 33.3, network: <networkId>, reportEndpoint: '/perf-report' };`
- the `HUD_SOURCE` string (imported from `../perf/hud-source`).

So the same util that injects mocks + validator checklist now also installs the HUD. HUD box is
top-right; the validator checklist UI uses its own corner — no overlap.

### 3. `server.ts` — two new routes (modify)

Within the existing request handler (alongside the other `url ===`/`url.match` branches, before the
`/preview/{networkId}` branch):

- `POST /perf-report`: read the JSON body, construct a `SessionResult`
  (`profile: { name:'none', cpuRate:1, net:null }`, `durationMs` from last sample `t`), call
  `analyze(result)` then `writeReport(metrics, result, join(outputDir, 'perf-reports'), baseName)`
  with `baseName = perf-<network>-<timestamp>`. Respond `200 application/json {"reportUrl":"/perf-reports/<file>.html"}`.
  On any error respond `500` with the message.
- `GET /perf-reports/<file>`: serve the written file from `join(outputDir, 'perf-reports', <file>)`
  with the right content-type (`.html` → text/html, `.json` → application/json). Validate `<file>`
  matches `^perf-[A-Za-z0-9_.-]+\.(html|json)$` to prevent path traversal.

`outputDir` is available in the server closure (passed to `startPreviewServer`).

### 4. `report.ts` disclaimer for `none` (small modify)

`renderHtml`'s disclaimer currently reads "CPU/network throttled to "<name>" (CPU <rate>x)…".
For `profile.name === 'none'`, render instead: "No CPU/network throttle applied — measured on this
machine as-is. For low-end emulation, set DevTools → Performance → CPU 6x. GPU/RAM not emulated;
validate on a real low-end device." Keep the throttled wording for low/mid.

## Data Flow

1. Panel Preview → `main.ts startPreview` → `startPreviewServer` → `shell.openExternal(${url}/preview/{net})`.
2. Server route `/preview/{net}` injects preview-util (mocks + checklist + HUD + `__plbxPerfConfig`).
3. Browser: HUD runs (top-frame), measures; `__perfEmit` absent → browser mode → "Stop & Report" shown.
4. Developer plays; spikes flash; `M` drops markers; `P` toggles.
5. Click "Stop & Report" → `POST /perf-report` with the buffered session.
6. Server: `analyze` + `writeReport` → files in `<outputDir>/perf-reports/` → `{reportUrl}`.
7. HUD: `window.open(reportUrl)` → report tab (verdict, frame-time timeline + spikes + markers, none-profile disclaimer).

## Error Handling

- POST fails / non-200 → HUD shows an inline error and downloads the raw session JSON (Blob +
  `<a download>`) so the captured data is not lost. HTML rendering stays server-side.
- Empty session (Stop with no samples) → report renders "No samples captured" (report.ts handles).
- Path traversal on `GET /perf-reports/<file>` → regex-validated filename; reject otherwise (404).
- HUD never breaks the creative (existing try/catch + top-frame guard).

## Testing

- Reused `analyze.ts`/`report.ts` tests stand.
- New integration test (`tests/core/perf-report-route.test.ts`): start the preview server against a
  fixture, `POST /perf-report` with a synthetic payload, assert 200 + `{reportUrl}`, assert the
  files exist under `perf-reports/`, then `GET` the returned `reportUrl` and assert 200 + HTML body.
  Also assert path-traversal filenames are rejected.
- HUD dual-mode string guards (extend `tests/core/perf-hud.test.ts`): asserts the source contains the
  buffer-mode branch (`reportEndpoint`), the Stop&Report control, and the `fetch(`POST`)` call.
- Manual: open the validator on a real build, measure, Stop & Report, confirm the report opens and
  shows markers/spikes; confirm the CLI path still streams + writes on close (no Stop button there).

## Assumptions

- HUD injected on every `/preview/{network}`, default measuring on; `P` hides. (No panel setting this iteration.)
- Reports written next to the build in `<outputDir>/perf-reports/`.
- No automatic throttle; low-end is manual DevTools (documented in the report).
- Single shared `hud-source.ts` serves CLI (stream) and browser (buffer+POST), branching on `window.__perfEmit`.

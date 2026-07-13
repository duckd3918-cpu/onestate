# Perf HUD — Extension Preview Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the perf HUD overlay the creative in the extension's existing `/preview/{network}` flow (external browser, no Playwright), with a "Stop & Report" action that POSTs the session to the preview server, which writes the same JSON+HTML report and opens it.

**Architecture:** Reuse `analyze.ts`/`report.ts`/`types.ts` unchanged. Make `hud-source.ts` dual-mode (CLI streams via `__perfEmit`; browser buffers + POST). `generatePreviewUtil` (already injected into every preview HTML) appends the HUD + a `__plbxPerfConfig`. The preview server gains `POST /perf-report` (analyze + writeReport) and `GET /perf-reports/<file>` (serve the written report).

**Tech Stack:** TypeScript (tsc → dist, CommonJS), Node `http` server, vanilla JS in-page HUD, vitest.

**Design spec:** `docs/superpowers/specs/2026-06-08-perf-hud-extension-integration-design.md`

**Branch:** `feat/playable-perf-test` (continue here; do NOT switch).

**Repo conventions:** tests in `tests/**/*.test.ts` (vitest, import from `../../src/...`), run one suite `npm test -- <fragment>`; build `npm run build`; `docs/` gitignored (not committed).

---

## File Structure

| File | Change |
|------|--------|
| `src/core/perf/report.ts` | `renderHtml` disclaimer branches for `profile.name === 'none'` |
| `src/core/perf/hud-source.ts` | dual-mode: buffer + Stop&Report button + POST when `__perfEmit` absent and `reportEndpoint` set |
| `src/core/preview/sdk-mocks.ts` | `generatePreviewUtil` appends `__plbxPerfConfig` + `HUD_SOURCE` |
| `src/core/preview/server.ts` | `readBody` helper + `POST /perf-report` + `GET /perf-reports/<file>` routes; import analyze/writeReport |
| `tests/core/perf-report.test.ts` | + none-disclaimer assertion |
| `tests/core/perf-hud.test.ts` | + browser-mode string guards |
| `tests/core/preview-util-perf.test.ts` | new: HUD+config injected |
| `tests/core/perf-report-route.test.ts` | new: POST/GET route integration |

---

## Task 1: Report disclaimer for the untrottled (`none`) profile

**Files:**
- Modify: `src/core/perf/report.ts`
- Test: `tests/core/perf-report.test.ts`

- [ ] **Step 1: Add the failing test** — append inside the existing `describe('renderHtml', ...)` block in `tests/core/perf-report.test.ts`:

```ts
  it('uses an untrottled disclaimer for the none profile', () => {
    const r = fixture();
    r.profile = { name: 'none', cpuRate: 1, net: null };
    const html = renderHtml(analyze(r), r);
    expect(html).toContain('No CPU/network throttle applied');
    expect(html).toContain('CPU 6x');
    expect(html).not.toContain('throttled to "none"');
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- perf-report`
Expected: the new test FAILS (current disclaimer says `throttled to "none" (CPU 1x)`).

- [ ] **Step 3: Implement** — in `src/core/perf/report.ts`, replace the `const disclaimer = ...` assignment in `renderHtml` with:

```ts
  const disclaimer =
    p.name === 'none'
      ? `No CPU/network throttle applied — measured on this machine as-is. For low-end emulation, ` +
        `set DevTools → Performance → CPU 6x. GPU/RAM not emulated; validate on a real low-end device.`
      : `CPU/network throttled to "${p.name}" (CPU ${p.cpuRate}x). GPU runs at host speed — ` +
        `fillrate/RAM not emulated. Validate GPU-bound and memory on a real low-end device.`;
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test -- perf-report`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/report.ts tests/core/perf-report.test.ts
git commit -m "feat(perf): untrottled disclaimer for none profile in report"
```

---

## Task 2: Dual-mode HUD (buffer + Stop&Report + POST)

**Files:**
- Modify: `src/core/perf/hud-source.ts`
- Test: `tests/core/perf-hud.test.ts`

**Context:** Today the HUD streams every event through `window.__perfEmit` (the Playwright binding). In the extension's external browser there is no such binding, so the HUD must buffer locally and POST on demand. Branch on `__perfEmit` presence + a `reportEndpoint` in config. CLI behavior must stay identical (no button, still streams).

- [ ] **Step 1: Add failing string-guard test** — append inside the existing `describe('HUD_SOURCE', ...)` block in `tests/core/perf-hud.test.ts`:

```ts
  it('browser mode: buffers + Stop & Report + POST when reportEndpoint is set', () => {
    expect(HUD_SOURCE).toContain('browserMode');
    expect(HUD_SOURCE).toContain('reportEndpoint');
    expect(HUD_SOURCE).toContain('Stop & Report');
    expect(HUD_SOURCE).toContain("method: 'POST'");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- perf-hud`
Expected: the new test FAILS (tokens absent).

- [ ] **Step 3a: Add dual-mode state** — in `src/core/perf/hud-source.ts`, replace this line:

```ts
    var markerIndex = 0, firstFrameSent = false;
```

with:

```ts
    var markerIndex = 0, firstFrameSent = false;
    var hasEmit = typeof window.__perfEmit === 'function';
    var browserMode = !hasEmit && !!cfg.reportEndpoint;
    var buf = { samples: [], spikes: [], markers: [], loadToFirstFrameMs: 0, timeToGameReadyMs: null };
```

- [ ] **Step 3b: Make emit dual-mode** — replace this block:

```ts
    function emit(type, data) {
      try { if (window.__perfEmit) window.__perfEmit({ type: type, data: data }); } catch (e) {}
    }
```

with:

```ts
    function emit(type, data) {
      if (hasEmit) { try { window.__perfEmit({ type: type, data: data }); } catch (e) {} }
      if (!browserMode) return;
      if (type === 'sample') buf.samples.push(data);
      else if (type === 'spike') buf.spikes.push(data);
      else if (type === 'marker') buf.markers.push(data);
      else if (type === 'firstFrame') buf.loadToFirstFrameMs = data.t;
      else if (type === 'gameReady') buf.timeToGameReadyMs = data.t;
    }
```

- [ ] **Step 3c: Add the Stop&Report button (browser mode)** — replace this line:

```ts
    window.__plbxPerf = { version: 1 };
```

with:

```ts
    if (browserMode) {
      var btn = document.createElement('button');
      btn.textContent = '⏺ Stop & Report';
      btn.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483647;font:12px/1 monospace;background:#c33;color:#fff;border:0;border-radius:4px;padding:8px 12px;cursor:pointer';
      var ensureBtn = function () { if (!btn.parentNode && document.body) document.body.appendChild(btn); };
      setInterval(ensureBtn, 300); ensureBtn();
      btn.addEventListener('click', function () {
        measuring = false;
        var payload = JSON.stringify({
          network: cfg.network || 'session',
          samples: buf.samples, spikes: buf.spikes, markers: buf.markers,
          loadToFirstFrameMs: buf.loadToFirstFrameMs, timeToGameReadyMs: buf.timeToGameReadyMs
        });
        btn.textContent = '… generating report';
        fetch(cfg.reportEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { if (j && j.reportUrl) window.open(j.reportUrl, '_blank'); btn.textContent = '✔ report opened'; })
          .catch(function () {
            btn.textContent = '✖ report failed — JSON downloaded';
            try {
              var blob = new Blob([payload], { type: 'application/json' });
              var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = 'perf-' + (cfg.network || 'session') + '.json'; a.click();
            } catch (e2) {}
          });
      });
    }

    window.__plbxPerf = { version: 1 };
```

- [ ] **Step 4: Run tests + build**

Run: `npm test -- perf-hud` → expect PASS (6 tests: existing 6 stay green plus this new one = check count, all pass).
Run: `npm run build` → expect clean (string still backtick-balanced; the inner JS uses only single quotes — verify no stray backtick / `${` was introduced).

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/hud-source.ts tests/core/perf-hud.test.ts
git commit -m "feat(perf): dual-mode HUD — buffer + Stop&Report + POST for browser preview"
```

---

## Task 3: Inject HUD + config via generatePreviewUtil

**Files:**
- Modify: `src/core/preview/sdk-mocks.ts`
- Test: `tests/core/preview-util-perf.test.ts` (new)

**Context:** `generatePreviewUtil({ networkId, mraid, maxSize })` builds the script the preview server injects into every `/preview/{network}` HTML (mocks + validator checklist; it sets `window.gameReady` itself). Appending the config + HUD at the END means the HUD's `gameReady` wrapper captures the util's `gameReady` as its `existing` (preserving lifecycle tracking), and `__plbxPerfConfig` is set before the HUD IIFE runs.

- [ ] **Step 1: Write the failing test** — `tests/core/preview-util-perf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generatePreviewUtil } from '../../src/core/preview/sdk-mocks';

describe('generatePreviewUtil perf injection', () => {
  const util = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5_000_000 });

  it('sets __plbxPerfConfig with network + report endpoint', () => {
    expect(util).toContain('__plbxPerfConfig');
    expect(util).toContain('"applovin"');
    expect(util).toContain("reportEndpoint: '/perf-report'");
  });
  it('appends the HUD source', () => {
    expect(util).toContain('window.__plbxPerf');
    expect(util).toContain('requestAnimationFrame');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- preview-util-perf`
Expected: FAIL (`__plbxPerfConfig` absent from the util).

- [ ] **Step 3a: Import HUD_SOURCE** — in `src/core/preview/sdk-mocks.ts`, add at the top of the file's import section (the file currently has no imports — add this as the first line):

```ts
import { HUD_SOURCE } from '../perf/hud-source';
```

- [ ] **Step 3b: Append config + HUD before the return** — in `generatePreviewUtil`, immediately before `return parts.join('');`, add:

```ts
  // Perf HUD: config first (HUD reads window.__plbxPerfConfig on start), then the
  // HUD IIFE. Appended last so its gameReady wrapper captures the util's gameReady
  // (set above) as `existing` — preserving validator lifecycle tracking.
  parts.push(
    '\nwindow.__plbxPerfConfig = { spikeThresholdMs: 33.3, network: ' +
      JSON.stringify(networkId) +
      ", reportEndpoint: '/perf-report' };\n",
  );
  parts.push(HUD_SOURCE);
```

- [ ] **Step 4: Run test + build**

Run: `npm test -- preview-util-perf` → expect PASS (2 tests).
Run: `npm run build` → expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/preview/sdk-mocks.ts tests/core/preview-util-perf.test.ts
git commit -m "feat(perf): inject perf HUD + config into preview-util"
```

---

## Task 4: Server routes — POST /perf-report + GET /perf-reports/<file>

**Files:**
- Modify: `src/core/preview/server.ts`
- Test: `tests/core/perf-report-route.test.ts` (new)

**Context:** `startPreviewServer({ outputDir, networks })` runs an `http` server whose handler is `async (req, res) => { ... }` with `outputDir` in closure and a chain of `if (url === ...)` / `url.match(...)` branches ending in a 404. `basename` is already imported from `path`. Add the two routes before the final 404, and a `readBody` helper at module scope.

- [ ] **Step 1: Write the failing integration test** — `tests/core/perf-report-route.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { startPreviewServer, stopPreviewServer } from '../../src/core/preview/server';

const OUT = join(__dirname, '..', 'fixtures', 'roadside-build', 'output');

describe('POST /perf-report', () => {
  afterEach(async () => {
    await stopPreviewServer();
    rmSync(join(OUT, 'perf-reports'), { recursive: true, force: true });
  });

  it('writes report files and returns a reportUrl that serves HTML', async () => {
    const { url } = await startPreviewServer({ outputDir: OUT, networks: ['applovin'] });
    const payload = {
      network: 'applovin',
      samples: [
        { t: 0, fps: 60, frameMs: 16, heapMB: 100 },
        { t: 16, fps: 60, frameMs: 16, heapMB: 100 },
      ],
      spikes: [{ t: 16, frameMs: 40, fps: 25, heapMB: 100 }],
      markers: [{ t: 8, index: 1 }],
      loadToFirstFrameMs: 5,
      timeToGameReadyMs: 50,
    };
    const resp = await fetch(`${url}/perf-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.reportUrl).toMatch(/^\/perf-reports\/perf-applovin-\d+\.html$/);

    const file = body.reportUrl.split('/').pop() as string;
    expect(existsSync(join(OUT, 'perf-reports', file))).toBe(true);

    const getResp = await fetch(`${url}${body.reportUrl}`);
    expect(getResp.status).toBe(200);
    expect(await getResp.text()).toContain('<canvas');
  });

  it('rejects a non-conforming report filename (path traversal guard)', async () => {
    const { url } = await startPreviewServer({ outputDir: OUT, networks: ['applovin'] });
    const resp = await fetch(`${url}/perf-reports/secret.txt`);
    expect(resp.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- perf-report-route`
Expected: FAIL — POST returns 404 (route absent).

- [ ] **Step 3a: Add imports** — in `src/core/preview/server.ts`, after the existing import block (after the `import { detectRegionalParams } ...` line) add:

```ts
import { analyze } from '../perf/analyze';
import { writeReport } from '../perf/report';
import { SessionResult } from '../perf/types';
```

- [ ] **Step 3b: Add the readBody helper** — add at module scope (e.g. directly above `function injectPreviewUtil`):

```ts
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
```

- [ ] **Step 3c: Add the two routes** — in the request handler, immediately before the final `// 404` block (`res.writeHead(404, ...); res.end('Not found');`), insert:

```ts
        // POST /perf-report — write a perf report from a browser HUD session
        if (req.method === 'POST' && url === '/perf-report') {
          const data = JSON.parse(await readBody(req));
          const samples = Array.isArray(data.samples) ? data.samples : [];
          const lastT = samples.length ? samples[samples.length - 1].t : 0;
          const result: SessionResult = {
            samples,
            spikes: Array.isArray(data.spikes) ? data.spikes : [],
            markers: Array.isArray(data.markers) ? data.markers : [],
            loadToFirstFrameMs: data.loadToFirstFrameMs || 0,
            timeToGameReadyMs: data.timeToGameReadyMs ?? null,
            durationMs: lastT,
            profile: { name: 'none', cpuRate: 1, net: null },
          };
          const metrics = analyze(result);
          const net = String(data.network || 'session').replace(/[^A-Za-z0-9_-]/g, '');
          const baseName = `perf-${net}-${Date.now()}`;
          const { htmlPath } = writeReport(metrics, result, join(outputDir, 'perf-reports'), baseName);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reportUrl: `/perf-reports/${basename(htmlPath)}` }));
          return;
        }

        // GET /perf-reports/<file> — serve a written report (filename-validated)
        const reportMatch = url.match(/^\/perf-reports\/(perf-[A-Za-z0-9_.-]+\.(?:html|json))$/);
        if (reportMatch) {
          const filePath = join(outputDir, 'perf-reports', reportMatch[1]);
          if (!existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Report not found');
            return;
          }
          const ct = reportMatch[1].endsWith('.json')
            ? 'application/json'
            : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': ct });
          res.end(readFileSync(filePath));
          return;
        }
```

- [ ] **Step 4: Run test + build**

Run: `npm test -- perf-report-route` → expect PASS (2 tests).
Run: `npm run build` → expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/preview/server.ts tests/core/perf-report-route.test.ts
git commit -m "feat(perf): preview server POST /perf-report + GET /perf-reports route"
```

---

## Task 5: Full gate + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full suite + build**

Run: `npm test && npm run build`
Expected: all suites pass (prior + the new perf-report/hud/preview-util/route tests), build clean.

- [ ] **Step 2: Manual smoke in the real validator flow**

In your own terminal (so the external browser window appears), build then start a preview against a real build and open it the way the extension does — or run the CLI preview server and open the URL:

```bash
npm run build
node -e "require('./dist/core/preview/server').startPreviewServer({outputDir:'<workspace>/Playables/_Prod/<project>/build/plbx-html', networks:['mintegral']}).then(r=>console.log('open:', r.url+'/preview/mintegral'))"
```

Open the printed URL in your browser.
Expected:
- Creative loads with the HUD top-right (FPS/MS/MEM + sparkline) and a red "⏺ Stop & Report" button bottom-right.
- Spikes flash red; `M` drops a marker (yellow outline flash); `P` toggles measuring.
- Click "Stop & Report" → a new tab opens with the HTML report (verdict, frame-time timeline + spikes + markers, the **none-profile** disclaimer "No CPU/network throttle applied … CPU 6x").
- The report file exists at `<build>/plbx-html/perf-reports/perf-mintegral-<ts>.html`.

- [ ] **Step 3: Confirm CLI path unchanged**

Run (own terminal): `npm run perf -- <workspace>/Playables/_Prod/<project>/build/plbx-html mintegral --profile low`
Expected: headed Chromium, HUD streams spikes to the terminal, NO "Stop & Report" button (CLI mode), close window → report written + opened as before. (Confirms dual-mode didn't break the CLI.)

---

## Self-Review (completed during planning)

- **Spec coverage:** HUD overlay in preview (Tasks 2+3), live FPS/markers/toggle (Task 2, reused), Stop&Report → POST (Task 2), server writes report reusing analyze/report (Task 4), GET serves report (Task 4), dual-mode CLI+browser one source (Task 2), none-profile disclaimer (Task 1), error fallback raw-JSON download (Task 2), path-traversal guard (Task 4). All covered.
- **Placeholder scan:** no TBD/TODO; all steps carry complete code.
- **Type consistency:** the POST handler builds a `SessionResult` (matches `types.ts`: samples/spikes/markers/loadToFirstFrameMs/timeToGameReadyMs/durationMs/profile) and passes it to `analyze` then `writeReport(metrics, result, dir, baseName)` — same signatures as the CLI uses. HUD POST payload keys exactly match the keys the server reads (`network, samples, spikes, markers, loadToFirstFrameMs, timeToGameReadyMs`). `reportUrl` shape (`/perf-reports/<file>.html`) matches the `GET` route regex and the test assertion.
- **Reuse:** `analyze.ts`/`report.ts` untouched except Task 1's disclaimer; `hud-source.ts` stays a single source serving both consumers.

# Preview Validator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Built-in playable ad validator — local HTTP server loads builds in iframe, injects tracker script, validates lifecycle/CTA/size/errors via postMessage.

**Architecture:** Preview Server (Node.js `http.createServer`) serves builds with injected `preview-util.js` → Validator UI (static HTML/JS) displays checklist updated via `postMessage` from iframe.

**Tech Stack:** Node.js `http`/`net`, JSZip (already in deps), TypeScript, plain HTML/CSS/JS for UI.

**Design doc:** `docs/plans/2026-03-11-preview-validator-design.md`

---

### Task 1: SDK Mocks Module

**Files:**
- Create: `src/core/preview/sdk-mocks.ts`
- Test: `tests/core/preview/sdk-mocks.test.ts`

**Step 1: Write the failing test**

Create `tests/core/preview/sdk-mocks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generatePreviewUtil } from '../../src/core/preview/sdk-mocks';

describe('generatePreviewUtil', () => {
  it('should return a string with report function', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5 * 1024 * 1024 });
    expect(code).toContain('function report(');
    expect(code).toContain("parent.postMessage");
    expect(code).toContain("plbx:preview");
  });

  it('should include error tracking (onerror + unhandledrejection)', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5242880 });
    expect(code).toContain('window.onerror');
    expect(code).toContain('onunhandledrejection');
  });

  it('should wrap fetch and XMLHttpRequest for network tracking', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5242880 });
    expect(code).toContain('XMLHttpRequest');
    expect(code).toContain('fetch');
  });

  it('should mock MRAID for mraid networks', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5242880 });
    expect(code).toContain('window.mraid');
    expect(code).toContain("report('cta'");
  });

  it('should mock window.install for mintegral', () => {
    const code = generatePreviewUtil({ networkId: 'mintegral', mraid: false, maxSize: 5242880 });
    expect(code).toContain('window.install');
    expect(code).not.toContain('window.mraid');
  });

  it('should mock ExitApi for google', () => {
    const code = generatePreviewUtil({ networkId: 'google', mraid: false, maxSize: 5242880 });
    expect(code).toContain('ExitApi');
  });

  it('should mock FbPlayableAd for facebook', () => {
    const code = generatePreviewUtil({ networkId: 'facebook', mraid: false, maxSize: 5242880 });
    expect(code).toContain('FbPlayableAd');
  });

  it('should define lifecycle trackers (gameReady, gameStart, gameClose)', () => {
    const code = generatePreviewUtil({ networkId: 'applovin', mraid: true, maxSize: 5242880 });
    expect(code).toContain('gameReady');
    expect(code).toContain('gameStart');
    expect(code).toContain('gameClose');
    expect(code).toContain("report('game_ready'");
    expect(code).toContain("report('game_start'");
  });

  it('should wrap window.open as generic CTA fallback', () => {
    const code = generatePreviewUtil({ networkId: 'gdt', mraid: false, maxSize: 5242880 });
    expect(code).toContain('window.open');
    expect(code).toContain("report('cta'");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/preview/sdk-mocks.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/core/preview/sdk-mocks.ts`:

```typescript
export interface PreviewUtilParams {
  networkId: string;
  mraid: boolean;
  maxSize: number;
}

export function generatePreviewUtil(params: PreviewUtilParams): string {
  const { networkId, mraid } = params;
  const parts: string[] = [];

  // Phase 1: Reporting
  parts.push(`
(function() {
  var _plbxEvents = [];
  function report(event, data) {
    _plbxEvents.push({ event: event, data: data, time: Date.now() });
    try {
      parent.postMessage({ type: 'plbx:preview', event: event, data: data || {} }, '*');
    } catch(e) {}
  }
  window.__plbxReport = report;
`);

  // Phase 2: Error tracking
  parts.push(`
  var _errors = [];
  window.onerror = function(msg, src, line, col, err) {
    _errors.push({ message: String(msg), source: src, line: line });
    report('error', { message: String(msg), source: src, line: line, col: col });
  };
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection';
    _errors.push({ message: msg });
    report('error', { message: msg });
  });
`);

  // Phase 3: Network request tracking
  parts.push(`
  var _requests = [];
  var _whitelist = [location.hostname, 'localhost', '127.0.0.1', ''];

  function isExternal(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return false;
    try {
      var h = new URL(url, location.href).hostname;
      return _whitelist.indexOf(h) === -1;
    } catch(e) { return false; }
  }

  // Wrap XMLHttpRequest
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var u = String(url);
    _requests.push(u);
    if (isExternal(u)) report('external_request', { url: u });
    return _xhrOpen.apply(this, arguments);
  };

  // Wrap fetch
  if (window.fetch) {
    var _origFetch = window.fetch;
    window.fetch = function(input) {
      var u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      _requests.push(u);
      if (isExternal(u)) report('external_request', { url: u });
      return _origFetch.apply(this, arguments);
    };
  }

  // Wrap Image.src
  var _imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (_imgDesc && _imgDesc.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      set: function(v) {
        if (isExternal(v)) report('external_request', { url: v, type: 'image' });
        _imgDesc.set.call(this, v);
      },
      get: _imgDesc.get,
      configurable: true
    });
  }
`);

  // Phase 4: SDK mocks (network-specific)
  if (mraid) {
    parts.push(`
  // MRAID mock
  window.mraid = window.mraid || {
    _state: 'loading',
    _listeners: {},
    getState: function() { return this._state; },
    addEventListener: function(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    removeEventListener: function(evt, fn) {
      if (!this._listeners[evt]) return;
      this._listeners[evt] = this._listeners[evt].filter(function(f) { return f !== fn; });
    },
    open: function(url) { report('cta', { url: url, method: 'mraid.open' }); },
    close: function() { report('game_close', { method: 'mraid.close' }); },
    isViewable: function() { return true; },
    getVersion: function() { return '2.0'; },
    _fireReady: function() {
      this._state = 'default';
      (this._listeners['ready'] || []).forEach(function(fn) { try { fn(); } catch(e) {} });
    }
  };
  setTimeout(function() { if (window.mraid._fireReady) window.mraid._fireReady(); }, 100);
`);
  }

  if (networkId === 'mintegral') {
    parts.push(`
  // Mintegral mock: CTA via window.install()
  window.install = function() { report('cta', { method: 'install' }); };
`);
  }

  if (networkId === 'google') {
    parts.push(`
  // Google Ads mock
  window.ExitApi = { exit: function() { report('cta', { method: 'exitapi' }); } };
`);
  }

  if (networkId === 'facebook') {
    parts.push(`
  // Facebook mock
  window.FbPlayableAd = { onCTAClick: function() { report('cta', { method: 'fbplayable' }); } };
`);
  }

  if (networkId === 'tiktok' || networkId === 'pangle') {
    parts.push(`
  // TikTok/Pangle playable SDK mock
  window.playableSDK = window.playableSDK || {
    openAppStore: function() { report('cta', { method: 'playable_sdk' }); }
  };
`);
  }

  if (networkId === 'bigo') {
    parts.push(`
  // Bigo MRAID SDK mock
  window.BGY_MRAID = { open: function(url) { report('cta', { url: url, method: 'bgy_mraid' }); } };
`);
  }

  // Generic CTA fallback: wrap window.open
  parts.push(`
  // Generic CTA: wrap window.open
  var _origOpen = window.open;
  window.open = function(url, target) {
    report('cta', { url: url, method: 'window.open' });
    // Don't actually navigate in preview
    return null;
  };
`);

  // Phase 5: Lifecycle tracking
  parts.push(`
  // Lifecycle tracking
  window.gameReady = function() { report('game_ready', {}); };
  window.gameStart = function() { report('game_start', {}); };
  window.gameClose = function() { report('game_close', {}); };
  window.gameEnd = function() { report('game_end', {}); };

  // Signal load complete
  report('preview_loaded', { networkId: '${networkId}' });
`);

  parts.push(`
})();
`);

  return parts.join('');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/preview/sdk-mocks.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Commit**

```bash
git add src/core/preview/sdk-mocks.ts tests/core/preview/sdk-mocks.test.ts
git commit -m "feat(preview): add SDK mocks module for preview validator"
```

---

### Task 2: Preview Server

**Files:**
- Create: `src/core/preview/server.ts`
- Test: `tests/core/preview/server.test.ts`

**Step 1: Write the failing test**

Create `tests/core/preview/server.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { startPreviewServer, stopPreviewServer } from '../../src/core/preview/server';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import http from 'http';

function httpGet(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => body += chunk);
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body,
        headers: res.headers as Record<string, string>,
      }));
    }).on('error', reject);
  });
}

const TMP = join(__dirname, '../fixtures/preview-test-tmp');

describe('Preview Server', () => {
  afterEach(async () => {
    await stopPreviewServer();
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  });

  it('should start on a free port and serve validator UI at /', async () => {
    mkdirSync(join(TMP, 'applovin'), { recursive: true });
    writeFileSync(join(TMP, 'applovin', 'index.html'), '<html><head></head><body>test</body></html>');

    const { port, url } = await startPreviewServer({
      outputDir: TMP,
      networks: ['applovin'],
    });

    expect(port).toBeGreaterThan(0);
    const res = await httpGet(url);
    expect(res.status).toBe(200);
    expect(res.body).toContain('plbx:preview'); // validator UI references this
  });

  it('should serve /api/networks with network metadata', async () => {
    mkdirSync(join(TMP, 'applovin'), { recursive: true });
    writeFileSync(join(TMP, 'applovin', 'index.html'), '<html><head></head><body>ok</body></html>');

    const { url } = await startPreviewServer({ outputDir: TMP, networks: ['applovin'] });
    const res = await httpGet(url + '/api/networks');
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('applovin');
    expect(data[0].size).toBeGreaterThan(0);
  });

  it('should serve /preview/{networkId} with injected preview-util.js', async () => {
    mkdirSync(join(TMP, 'ironsource'), { recursive: true });
    writeFileSync(join(TMP, 'ironsource', 'index.html'),
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>game</p></body></html>');

    const { url } = await startPreviewServer({ outputDir: TMP, networks: ['ironsource'] });
    const res = await httpGet(url + '/preview/ironsource');
    expect(res.status).toBe(200);
    expect(res.body).toContain('__plbxReport'); // from preview-util.js
    expect(res.body).toContain('window.mraid'); // ironsource is MRAID
    // preview-util should be injected BEFORE other scripts
    var utilIdx = res.body.indexOf('__plbxReport');
    var bodyIdx = res.body.indexOf('<body>');
    expect(utilIdx).toBeLessThan(bodyIdx);
  });

  it('should extract HTML from ZIP for singleFileZip networks', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('index.html', '<html><head></head><body>mintegral</body></html>');
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    mkdirSync(join(TMP, 'mintegral'), { recursive: true });
    writeFileSync(join(TMP, 'mintegral', 'index.zip'), zipBuf);

    const { url } = await startPreviewServer({ outputDir: TMP, networks: ['mintegral'] });
    const res = await httpGet(url + '/preview/mintegral');
    expect(res.status).toBe(200);
    expect(res.body).toContain('mintegral');
    expect(res.body).toContain('window.install'); // Mintegral CTA mock
  });

  it('should stop server cleanly', async () => {
    mkdirSync(join(TMP, 'applovin'), { recursive: true });
    writeFileSync(join(TMP, 'applovin', 'index.html'), '<html><head></head><body></body></html>');

    const { port } = await startPreviewServer({ outputDir: TMP, networks: ['applovin'] });
    await stopPreviewServer();

    await expect(httpGet('http://localhost:' + port + '/')).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/preview/server.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/core/preview/server.ts`. Key responsibilities:

- `GET /` — serve Validator UI (inline HTML with dark theme, network tabs, checklist, console panel)
- `GET /api/networks` — JSON list of built networks with size/maxSize/format metadata
- `GET /preview/{networkId}` — serve build HTML with injected preview-util.js as first `<script>` in `<head>`
- `GET /mraid.js` — mock MRAID SDK (empty, since preview-util handles mocking)
- `GET /static/*` — serve static files from `static/preview/` directory
- ZIP extraction for singleFileZip networks (mintegral, google, tiktok, etc.)

**Validator UI** (inline in `getValidatorHtml()`):
- Dark theme (#1a1a2e background)
- Network tabs at top, populated from `/api/networks`
- Left: iframe with build (`sandbox="allow-scripts allow-same-origin"`)
- Right sidebar: checklist (File size, Game loads, Game Ready, Game Start, CTA, Game Close, No external requests, No exceptions)
- Bottom: console panel with timestamped event log
- All DOM updates use safe methods: `document.createElement`, `textContent`, `appendChild` — **no innerHTML**
- Listens for `postMessage` with `type: 'plbx:preview'` from iframe
- 30s timeout for lifecycle checks

**Important implementation details:**
- Server binds to `127.0.0.1` on port `0` (OS picks free port)
- `findBuildFile()` scans `outputDir/{networkId}/` for `.html` or `.zip` files
- `extractHtmlFromZip()` uses JSZip to read `index.html` from ZIP
- `injectPreviewUtil()` inserts `<script>` right after `<head>` tag
- Module-level `_server` variable for singleton — `stopPreviewServer()` closes it

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/preview/server.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/core/preview/server.ts tests/core/preview/server.test.ts
git commit -m "feat(preview): add preview HTTP server with build injection"
```

---

### Task 3: Validator UI (static files)

**Files:**
- Create: `static/preview/index.html`
- Create: `static/preview/preview.css`
- Create: `static/preview/preview.js`

The server already has an inline fallback UI (Task 2), but for better maintainability, create proper static files.

**Step 1: Create `static/preview/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Playbox Preview Validator</title>
  <link rel="stylesheet" href="/static/preview/preview.css">
</head>
<body>
  <div class="tabs" id="tabs"></div>
  <div class="main">
    <iframe class="preview-frame" id="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
    <div class="sidebar">
      <h3>Validation Checklist</h3>
      <div id="checklist"></div>
    </div>
  </div>
  <div class="console" id="console"></div>
  <script src="/static/preview/preview.js"></script>
</body>
</html>
```

**Step 2: Create `static/preview/preview.css`**

Dark theme styles matching the inline version.

**Step 3: Create `static/preview/preview.js`**

UI logic using safe DOM methods only (`createElement`, `textContent`, `appendChild`, `removeChild`). No `innerHTML`.

Key behaviors:
- `fetch('/api/networks')` → build tabs dynamically
- `loadNetwork(id)` → reset checklist, set iframe src, start 30s timeout
- `window.addEventListener('message', handler)` → update checks on `plbx:preview` events
- `renderChecklist()` → clear children and rebuild with `createElement`
- `log(msg, cls)` → create `<div>` with `textContent`

**Step 4: Update server.ts to serve `/static/*` files**

Add in the request handler before the 404 fallback:

```typescript
if (url.startsWith('/static/')) {
  const filePath = join(__dirname, '../../../', url);
  if (existsSync(filePath)) {
    const ext = extname(filePath);
    const mimeMap: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'text/plain' });
    res.end(readFileSync(filePath));
    return;
  }
}
```

**Step 5: Commit**

```bash
git add static/preview/ src/core/preview/server.ts
git commit -m "feat(preview): add static validator UI files"
```

---

### Task 4: IPC Integration

**Files:**
- Modify: `src/main.ts` — add `startPreview` and `stopPreview` methods
- Modify: `package.json` — register new messages
- Modify: `src/panels/default.ts` — add Preview button to Package tab

**Step 1: Add IPC methods to `src/main.ts`**

Add import at top:
```typescript
import { startPreviewServer, stopPreviewServer } from './core/preview/server';
```

Add to `methods` object:
```typescript
async startPreview(outputDir: string, networkIds: string[]) {
  const { resolve } = require('path');
  const projectRoot = Editor.Project.path || '';
  const absOutputDir = resolve(projectRoot, outputDir);
  const result = await startPreviewServer({ outputDir: absOutputDir, networks: networkIds });
  // Open in default browser
  const { shell } = require('electron');
  shell.openExternal(result.url);
  return result;
},

async stopPreview() {
  await stopPreviewServer();
  return { stopped: true };
},
```

**Step 2: Register messages in `package.json`**

Add to `contributions.messages`:
```json
"start-preview": {
  "methods": ["startPreview"]
},
"stop-preview": {
  "methods": ["stopPreview"]
}
```

**Step 3: Add Preview button to panel**

In `src/panels/default.ts`, in the Package tab section:
- Add a Preview button (`<ui-button id="btn-preview">Preview</ui-button>`) next to the Build button
- Initially hidden (`display:none`), shown after successful build
- On click: call `Editor.Message.request('plbx-cocos-extension', 'startPreview', outputDir, selectedNetworks)`
- Disable button during server start, re-enable after

**Step 4: Run build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main.ts package.json src/panels/default.ts
git commit -m "feat(preview): add IPC integration and Preview button in panel"
```

---

### Task 5: Run all tests

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new preview tests)

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Fix any issues found**

If tests fail, fix the issues and re-run.

---

### Task 6: Push

**Step 1: Push to remote**

```bash
git push origin master
```

---

## MolocoV2 macro lifecycle validation

The launcher-payload target (network id `molocoV2`) ships two artifacts —
`launcher.html` (production, `#PAYLOAD_URL#` placeholder) and `payload.js`
(IIFE). The preview validator handles this format by:

1. **Server side** (`src/core/preview/server.ts`)
   - `findBuildFile()` prefers `launcher.html` + `payload.js` siblings over
     `index.html`/`.zip` when present.
   - `GET /preview/molocoV2` substitutes `#PAYLOAD_URL#` with
     `/preview/molocoV2/payload.js` and injects `preview-util.js`.
   - `GET /preview/molocoV2/payload.js` serves the actual IIFE.

2. **Macro intercept** (`src/core/preview/sdk-mocks.ts`)
   - Image.prototype.src setter, fetch, and XMLHttpRequest.open are all
     instrumented to call `_logMacroFire(url, channel)`.
   - On first fire, `_buildMacroLookup()` snapshots `window.MOLOCO_MACROS`
     into a reverse-lookup map keyed by both raw-encoded and decoded values.
   - Matched fires post `plbx:preview` messages with event `macro_fire` and
     payload `{ macroKey, url, channel, ts, stack }`. Unknown URLs are
     not reported (would just be noise).
   - Image patching is guarded by `window.__plbx_image_patched` so preview
     reloads don't stack setters.

3. **mraid mock variant**
   - For `molocoV2`, `_viewable` starts `false` and the auto-fire
     `viewableChange(true)` is suppressed — the "Viewable" button in the
     panel calls `mraid._fireViewableChange(true)` to simulate the ad
     container becoming viewable.
   - `_fireViewableChange`, `_fireExposureChange`, and `_setState` are
     exposed for manual control.
   - Every `addEventListener` call posts `mraid_listener_added` — the panel
     uses this to verify the payload registers a `viewableChange` listener
     (without that, `mraid_viewable` would never fire in production).

4. **Per-macro checklist** (`server.ts` → `getNetworkChecks('molocoV2')`)
   - Six tracked macros: `mraid_viewable`, `game_viewable`, `click`,
     `engagement`, `redirection`, `complete`. Each becomes a
     `macro_<key>` checklist item.
   - `viewable_listener` check — flips green on first
     `mraid_listener_added` for event `viewableChange`.
   - `final_url_used` check — flips green when `mraid.open(url)` is called
     with a URL matching `MOLOCO_MACROS.final_url` (raw or decoded).
   - `macro_start_muted` check — uses the `molocov2_start_muted` snapshot
     event comparing `MOLOCO_MACROS.start_muted` to `plbx_html.is_muted()`.

5. **UI states**
   - Pending: `⏳` grey — beacon not yet fired.
   - Fired once: `✅` green — beacon fired exactly once.
   - Multi-fire: `⚠️` yellow — beacon fired more than once (potential
     duplicate; verify intent).
   - Failed: `❌` red — beacon expected to fire (lifecycle reached) but
     didn't, or `final_url_used` saw a fallback URL.

6. **Manual triggers** (`static/preview/preview.js`)
   - Buttons send `plbx:molocov2` messages with actions `viewable`,
     `pause`, `resume`, `cta`, `game-end`, `simulate-taps`. The payload
     receives them via `window.addEventListener('message', ...)` inside
     the iframe.
   - "Simulate taps" reads the tap-count input and calls
     `plbx_html.tap()` that many times.
   - "Reset" reloads the preview iframe via `loadNetwork(currentNetwork)`
     so all state (macro counts, checklist, mraid mock) starts fresh.

7. **Gating**
   - All macro intercept + manual triggers are injected by the **preview
     server**, never by the packager. Production `launcher.html` +
     `payload.js` artifacts (uploaded to Moloco QA) contain zero
     preview-util code — verified by the existing `getForbiddenStrings()`
     guards plus the structural validator in `packager.ts`.

## Critical Notes for Implementer

1. **preview-util.js MUST be first `<script>` in `<head>`** — before any other scripts. This guarantees SDK mocks and lifecycle trackers are in place before the game boots.

2. **`gameReady` is defined by preview-util.js** (our validator), called by the game's runtime loader. **`gameStart` is defined by the game** (runtime loader), called by the validator. Do NOT confuse these roles.

3. **CTA is network-specific:**
   - MRAID networks (applovin, ironsource, unity): `mraid.open(url)`
   - Mintegral: `window.install()`
   - Google: `ExitApi.exit()`
   - Facebook: `FbPlayableAd.onCTAClick()`
   - Generic: `window.open(url)`

4. **ZIP extraction** is needed for singleFileZip networks (mintegral, google, tiktok, etc.) — use JSZip to read index.html from the ZIP before serving.

5. **Network request tracking** must patch APIs before runtime loader patches them.

6. **Server must bind to `127.0.0.1` on port 0** (auto-assigned free port).

7. **Existing tests must not break** — run `vitest run` before committing.

8. **Import from `../../shared/networks`** in server.ts to get network config.

9. **No innerHTML in UI code** — use safe DOM methods: `createElement`, `textContent`, `appendChild`.

10. **Electron `shell.openExternal(url)`** to open browser — available in Cocos Creator extension context.

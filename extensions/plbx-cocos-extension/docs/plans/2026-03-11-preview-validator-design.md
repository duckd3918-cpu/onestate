# Preview Validator — Design Document

## Goal

Built-in playable ad validator inside the Cocos Creator extension. After packaging, a "Preview" button opens a local browser page that loads each network's build in an iframe and runs automated checks (lifecycle calls, CTA detection, file size, network requests, code exceptions) — similar to Mintegral's PlayTurbo validator, but local and supporting all networks.

## Scope (Phase 1)

- **UI**: Separate browser window via localhost HTTP server
- **Device frames**: No (plain iframe + checklist)
- **Trigger**: Manual "Preview" button in Package tab after build
- **Checks**: File size, game loads, gameReady, gameStart, CTA call, gameClose, no external network requests, no code exceptions

## Architecture

Two components: **Preview Server** (Node.js HTTP) and **Validator UI** (static HTML/JS page).

### Flow

```
Package tab: [Preview] button click
  → IPC: start-preview { outputDir, networks[] }
  → main.ts: starts HTTP server on free port
  → Returns URL → opens in default browser

Browser loads Validator UI
  → Fetches network list from /api/networks
  → Loads build in iframe via /preview/{networkId}
  → Server injects preview-util.js into HTML on-the-fly
  → preview-util.js tracks lifecycle, CTA, errors, network requests
  → Sends results via postMessage → UI updates checklist
```

### Preview Server (`src/core/preview/server.ts`)

```
GET /                         → Validator UI (static HTML)
GET /api/networks             → JSON: list of built networks with metadata
GET /preview/{networkId}      → Build HTML with injected preview-util.js
GET /mraid.js                 → Mock MRAID SDK
GET /static/*                 → CSS/JS for validator UI
```

On serving `/preview/{networkId}`:
1. Read index.html from outputDir (extract from ZIP for singleFileZip networks)
2. Look up network config from `networks.ts`
3. Generate preview-util.js with correct SDK mocks for this network
4. Inject `<script>{preview-util}</script>` as first element in `<head>`
5. Serve modified HTML

### Preview-util.js (`src/core/preview/preview-util.ts`)

Generated per-network (like `generateRuntimeLoader`):

```typescript
function generatePreviewUtil(params: {
  networkId: string;
  networkConfig: NetworkConfig;
  maxSize: number;
}): string
```

Internal structure of injected script:

```
Phase 1: Setup reporting
  → function report(type, data) { parent.postMessage({type:'plbx:preview', event, data}, '*') }

Phase 2: Error tracking
  → window.onerror, window.onunhandledrejection → report('error', ...)

Phase 3: Network request tracking
  → Wrap fetch, XHR.open — log URL, flag external requests
  → Wrap Image.prototype.src setter
  → Whitelist: localhost, data:, blob:

Phase 4: SDK mocks (network-specific)
  → MRAID networks: window.mraid = { open(url) { report('cta', {url}) } }
  → Mintegral: window.install = function() { report('cta', {method:'install'}) }
  → Google: window.ExitApi = { exit() { report('cta', {method:'exitapi'}) } }
  → Facebook: window.FbPlayableAd = { onCTAClick() { report('cta', {method:'fbplayable'}) } }
  → Generic: wrap window.open → report('cta')

Phase 5: Lifecycle tracking
  → window.gameReady = function() { report('game_ready') }
  → window.gameStart = function() { report('game_start') }
  → window.gameClose = function() { report('game_close') }
  → window.gameEnd = function() { report('game_end') }
```

### Load Order Guarantee

```
1. preview-util.js (inline, first in <head>)          ← mocks + trackers
2. mraid.js (if present, served by our server)         ← mock SDK
3. Other <head> scripts
4. <body> scripts: adapter bridge (plbx_html), inline JS
5. Runtime loader: unpack ZIP → patchAPIs →
   define gameStart (SKIPPED — already defined by preview-util) →
   poll gameReady (FOUND — preview-util defined it) → call it → report tracked →
   bootCocos
```

This matches exactly how Mintegral's PlayTurbo validator works — preview-util.js is injected by the server before all other scripts.

### Validator UI (`static/preview/`)

Layout:
```
┌─────────────────────────────────────────────────┐
│ [▾ applovin] [ironsource] [mintegral] [google]  │  ← network tabs
├──────────────────────┬──────────────────────────┤
│                      │  ✅ File size    2.1/5MB  │
│                      │  ✅ Game loads            │
│    iframe            │  ✅ Game Ready            │
│    with build        │  ✅ Game Start            │
│                      │  ⏳ CTA Call     (click!) │
│                      │  ⏳ Game Close            │
│                      │  ✅ No ext requests       │
│                      │  ✅ No exceptions         │
├──────────────────────┴──────────────────────────┤
│ Console: [plbx] Calling gameReady               │
│          [plbx] gameStart called                │
└─────────────────────────────────────────────────┘
```

UI logic:
- Listens for `postMessage` from iframe (`type: 'plbx:preview'`)
- Updates checklist items in real-time (⏳ → ✅/❌)
- File size: `HEAD /preview/{networkId}` → `Content-Length` vs `network.maxSize`
- Game loads: iframe `load` event + no fatal errors within 5s
- 30s timeout on lifecycle checks → if not received → ❌
- Console panel shows timestamped event log

### Checklist Definitions

| Check | Pass condition | Fail condition |
|-------|---------------|----------------|
| File size | `outputSize <= network.maxSize` | Over limit |
| Game loads | iframe `load` + no errors in 5s | Error or timeout |
| Game Ready | `gameReady()` called | Not called within 30s |
| Game Start | `gameStart()` called | Not called within 30s |
| CTA Call | `install`/`mraid.open`/`ExitApi.exit` called | User must click CTA button |
| Game Close | `gameClose()` called | Not called (may require user interaction) |
| No external requests | Zero requests to non-localhost URLs | Any external request flagged |
| Code exceptions | Zero uncaught errors | Any error → show message |

### IPC Integration

New messages in `package.json` contributions:
- `start-preview` → starts server, returns `{ port, url }`
- `stop-preview` → stops server

In Package tab: "Preview" button (enabled after successful build).

### File Structure

```
src/core/preview/
  server.ts          — HTTP server (http.createServer, dynamic port)
  preview-util.ts    — Per-network tracker script generator
  sdk-mocks.ts       — SDK mocks (mraid, install, ExitApi, FbPlayableAd)
static/preview/
  index.html         — Validator UI shell
  preview.js         — UI logic (postMessage listener, checklist, tabs)
  preview.css        — Styles
```

## Key Lessons from Mintegral Debugging

These were discovered during PlayTurbo validator integration and MUST be preserved:

1. **Never overwrite validator-provided functions** (`gameReady`, etc.) — use `if (typeof window.X !== 'function')` guards in runtime loader
2. **gameReady is defined by the validator, called by us. gameStart is defined by us, called by the validator.** Do not confuse these roles.
3. **preview-util.js timing is critical** — must load BEFORE all other scripts
4. **Polling for gameReady** is necessary because injection timing varies
5. **CTA is network-specific**: `window.install()` for Mintegral, `mraid.open()` for MRAID, `ExitApi.exit()` for Google
6. **Network request detection** must patch APIs before runtime loader patches them

## Phase 2 (Future)

- Device frames (iPhone/iPad) with orientation toggle
- SDK environment emulation (real preview-util.js behavior per network)
- Auto-open after build
- Export validation report

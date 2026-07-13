# plbx-cocos-extension

Cocos Creator 3.8+ extension that packages `web-mobile` builds into playable
ads for 25+ ad networks (HTML or ZIP per network), with compression, a local
preview validator, and deploy to the Playbox platform (plbx.ai).

## Commands

- Build: `npm run build` (tsc → `dist/`), watch: `npm run watch`
- Tests: `npx vitest run` (single file: `npx vitest run tests/path/to.test.ts`)
- Install into Cocos: Extension Manager → Development Import → this folder.
  The editor caches the loaded `dist/main.js` and panel statics — after a
  rebuild, restart the editor (or Developer → Reload) to pick up changes.

## Architecture

- `src/main.ts` — all IPC methods (entry point). IPC pattern: panel calls
  `Editor.Message.request('plbx-cocos-extension', '<message>', ...)`; messages
  are registered in `package.json` `contributions.messages` and must map to a
  method in `main.ts`. All IPC data must be JSON-serializable.
- `src/panels/default.ts` + `static/template/index.html` + `static/style/` —
  dockable panel UI (Build Report / Compress / Package / Deploy tabs).
- `src/core/` — editor-independent business logic:
  - `packager/` — HTML/ZIP builders, network adapters
    (`network-adapters/`), self-contained runtime loader
    (`runtime-loader.ts`), loading splash (`splash.ts`), Moloco V2
    launcher+payload (`launcher-builder.ts`), store-URL scan/fix
    (`store-url-extractor.ts`)
  - `preview/` — local HTTP validator (`server.ts`, UI in
    `static/preview/`) + SDK mocks (`sdk-mocks.ts`)
  - `compression/` — sharp (images) + ffmpeg (audio)
  - `deployer/` — Playbox API client + uploader
  - `freshness/` + `updater/` — self-update (see below)
  - `settings.ts` — Cocos profile read/write
- `tests/fixtures/roadside-build/` — real Cocos web-mobile build used by tests.

## Releases & self-update

- Versioning: bump `package.json` version before every push; tag `vX.Y.Z`
  and push the tag — the pushed tag IS the publish step.
- Release notes: every version bump MUST ship a GitHub Release with notes —
  `gh release create vX.Y.Z --title "..." --notes-file <file> --latest`.
  Notes cover highlights (features/fixes, user-facing impact) + the commit list
  since the previous release. Do this as part of the bump, never skip it.
- Update check (`src/core/freshness/freshness-check.ts`): compares local
  `package.json` version against the max semver tag from the public GitHub
  `/tags` API. Pure version comparison — intentionally no git involvement
  (a detached HEAD / missing upstream / GUI PATH without git used to break
  it). Cached 10 min in `main.ts`.
- One-click update (`src/core/updater/update.ts`): git pull → npm install →
  npm run build, polled by the panel via `startUpdate`/`getUpdateState`.
  Requires a clean attached checkout; editor restart afterwards.

## Key gotchas

- Lifecycle: `gameReady` is defined by network validators and called by us;
  `gameStart` is defined by us and called by the validator. Never overwrite
  validator lifecycle functions.
- Mintegral CTA is `window.install()`, not `mraid.open()`.
- Games detect the build via `window.super_html_channel` and route CTA
  through `super_html`/`plbx_html` — the packager must set that marker.
- Cocos wraps `window.fetch` in injected code contexts — use XHR for
  injected POSTs.
- i18n files (`src/core/i18n/locales.ts`) are flat; Cocos namespaces them by
  extension name.
- Moloco V2 launcher has a strict 3 KB ceiling (`LAUNCHER_MAX_BYTES`) —
  packaging aborts if exceeded; the splash uses compact mode there.

## Docs index

- `docs/plans/` — feature design + implementation plans
  (e.g. `2026-05-28-moloco-v2-target-design.md` for the Moloco V2
  launcher/payload pipeline).
- `docs/networks/` — per-network specs we target
  (`axon-playable-analytics.md` — AppLovin Axon events).
- `docs/research/` — ad-network reference notes
  (`ad-networks-reference.md`), Cocos extension API notes, prior-art
  analysis (super-html runtime loader).
- `docs/superpowers/specs/` — approved feature specs (splash screen,
  self-contained loader, perf HUD, …); `docs/superpowers/plans/` — their
  implementation plans.

Docs are public — no absolute local paths, client project names, or personal
data in them.

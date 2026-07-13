# Ad Networks Playable Ads Requirements

> **Status:** Research complete for major networks. Last updated: 2026-03-11
> **Sources:** Official docs, PlayableTools, Luna Labs, 2DKit, web research

---

## Summary Table

| Network | CTA Method | MRAID | Size Limit | Format | Lifecycle | Validator |
|---------|-----------|-------|-----------|--------|-----------|-----------|
| **Facebook/Meta** | `FbPlayableAd.onCTAClick()` | No | **2 MB** (HTML) / 5 MB (ZIP) | HTML or ZIP | — | [Playable Preview](https://developers.facebook.com/tools/playable-preview/) |
| **Moloco** | `FbPlayableAd.onCTAClick()` | No | 5 MB | HTML | — | None |
| **Google Ads** | `ExitApi.exit()` | No | 5 MB | ZIP | — | [H5 Validator](https://h5validator.appspot.com/dcm/asset) (deprecated Apr 2025) |
| **Google DV360** | `Enabler.exit(name)` | No | 200 KB init / 10 MB total | ZIP | Enabler INIT, VISIBLE | CM360 upload |
| **AppLovin** | `mraid.open(url)` | MRAID 2.0 | 5 MB | HTML | mraid ready | [Web](https://p.applov.in/playablePreview?create=1&qr=1), [iOS](https://apps.apple.com/us/app/playable-preview/id6468529760), [Android](https://install.appcenter.ms/orgs/iosdeveloper-dbmy/apps/android-playable-preview/distribution_groups/all-users-of-android-playable-preview) |
| **Unity Ads** | `mraid.open(url)` | MRAID 2.0 | 5 MB | HTML | viewableChange | [iOS](https://apps.apple.com/us/app/ad-testing/id1463016906), [Android](https://play.google.com/store/apps/details?id=com.unity3d.auicreativetestapp) |
| **ironSource** | `dapi.openStoreUrl()` / `mraid.open(url)` | DAPI or MRAID 2.0 | 5 MB | HTML | dapi ready / mraid ready | [Test Tool](https://demos.ironsrc.com/test-tool/?adUnitLoader=dapi&mode=testing) |
| **Mintegral** | `window.install()` | No | 5 MB | ZIP | gameReady, gameStart, gameEnd, gameClose (**all required**) | [Mindworks](https://www.mindworks-creative.com/review/) |
| **TikTok/Pangle** | `playableSDK.openAppStore()` | No | 5 MB | ZIP | gameReady, gameStart | [Docs](https://ads.tiktok.com/help/article/playable-ads) |
| **Vungle** | `parent.postMessage('download','*')` | No (Adaptive) / MRAID 2.0 (Exchange) | 5 MB | ZIP | — | [Creative Verifier](https://vungle.com/creative-verifier/) |
| **AdColony** | `mraid.open(url)` | MRAID 2.0 | 2 MB | HTML | — | None |
| **Chartboost** | `mraid.open(url)` | MRAID 2.0 | **3 MB (hard)** | HTML (single bundled) | ready/stateChange/viewableChange; **no `mraid.close()`** | MRAID Upload tool — see [chartboost-playable.md](../networks/chartboost-playable.md) |
| **Tapjoy** | Tapjoy Click API | No | 2 MB | HTML | — | [playable.tapjoy.com](https://playable.tapjoy.com/) |
| **Liftoff** | `mraid.open(url)` | MRAID 2.0 | 5 MB | HTML | — | TODO |
| **Appreciate** | `mraid.open(url)` | MRAID | 5 MB | HTML | — | TODO |
| **Snapchat** | `mraid.open(url)` | MRAID 2.0 | 5 MB | ZIP | mraid ready | Creative Preview app |
| **Bigo** | `BGY_MRAID.open(url)` | No (own SDK) | 5 MB | ZIP | — | TODO |
| **myTarget** | `MTRG.onCTAClick()` | No (own API) | 2 MB | ZIP | — | None |
| **Bigabid** | `mraid.open(url)` | MRAID | 5 MB | ZIP | — | TODO |
| **inMobi** | `mraid.open(url)` | MRAID 2.0 | 5 MB | HTML | viewableChange | None |
| **Adikteev** | `mraid.open(url)` | MRAID | 5 MB | ZIP | — | TODO |
| **Smadex** | ? | No | 5 MB | HTML | — | TODO |
| **Rubeex** | ? | No | 5 MB | HTML | — | TODO |
| **Nefta** | ? | No | 5 MB | HTML (ZIP opt.) | — | TODO |
| **Kwai** | ? | No | 5 MB | ZIP | — | TODO |
| **GDT (Tencent)** | ? | No | 5 MB | ZIP | — | TODO |
| **NewsBreak** | ? | No | 5 MB | HTML | — | TODO |
| **Yandex** | `yandexHTML5BannerApi.getClickURLNum(1)` | No | 3 MB | ZIP | — | Manual moderation |

---

## Detailed Requirements

### Facebook/Meta

- **CTA:** `FbPlayableAd.onCTAClick()` — provided by container, no injection needed
- **Size:** **2 MB** (single HTML file), **5 MB** (ZIP total), index.html inside ZIP also max 2 MB, max 100 files in ZIP
- **MRAID:** No — must NOT include mraid.js
- **Blocked APIs:** No HTTP requests (XMLHttpRequest, fetch), no JS redirects (`window.location`), no localStorage/sessionStorage (sandboxed iframe without `allow-same-origin`)
- **Assets:** All must be inline (data-URI, base64) for single HTML. ZIP can have separate files.
- **Structure:** Single `.html`/`.htm` file, or ZIP with `index.html` at root
- **Validator checks:** Missing CTA function, file too large, redirect detection, anti-virus scan, file count
- **Note:** Validator does static text search for `FbPlayableAd.onCTAClick` — must appear as literal string
- **Sources:** [Meta Developers](https://developers.facebook.com/docs/app-ads/formats/playable-ad/), [Meta Business Help](https://www.facebook.com/business/help/412951382532338)

### Moloco

- **CTA:** `FbPlayableAd.onCTAClick()` — same as Facebook format
- **Size:** 5 MB
- **MRAID:** No — must NOT include mraid.js
- **Blocked:** Must NOT contain raw `XMLHttpRequest` — remove from PixiJS/Howler if present
- **Source:** [Moloco Help Center](https://help.moloco.com/hc/en-us/articles/24124525963799)

### Google Ads (App Campaigns)

- **CTA:** `ExitApi.exit()` — loaded from `https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js`
- **SDK injection:** Must be literal `<script>` in `<head>`, cannot be added via JS
- **Size:** 5 MB (ZIP), max 512 files
- **MRAID:** No
- **Meta tags:** `<meta name="ad.orientation" content="portrait">` (recommended over `ad.size`)
- **Audio:** Sound forbidden until first user interaction
- **External resources allowed:** Only Google Fonts, Google-hosted jQuery/GreenSock/CreateJS
- **File naming:** Only letters, digits, dots, dashes, underscores (no spaces)
- **Note:** If ExitApi not included, Google auto-adds Install button
- **Sources:** [Google Ads Help](https://support.google.com/google-ads/answer/9981650), [Fix issues](https://support.google.com/google-ads/answer/12771973)

### Google DV360 / Campaign Manager 360

- **CTA:** `Enabler.exit('Background Exit')` — SDK: `https://s0.2mdn.net/ads/studio/Enabler.js`
- **Size:** 200 KB initial load, up to 10 MB with polite loading
- **Lifecycle:** `StudioEvent.INIT` → `StudioEvent.VISIBLE` → start animation
- **Note:** Exit URLs set in Studio/CM360, not in code

### AppLovin

- **CTA:** `mraid.open(url)` — only valid CTA method
- **Size:** 5 MB (single inline HTML, all assets base64)
- **MRAID:** 2.0 — `<script src="mraid.js"></script>`
- **Lifecycle:** Wait for mraid `ready` event before DOM operations
- **Orientation:** Both portrait AND landscape **required**
- **Audio:** No auto-play before user interaction. Sound off when playable closes
- **External requests:** **Forbidden** — creative rejected without AppLovin approval
- **Close button:** Don't add — AppLovin provides its own
- **Analytics:** `window.ALPlayableAnalytics.trackEvent(name)` — optional Axon Events (Luna/Unity SDK feature, may not be available in raw HTML playables)
- **Duration:** Rewarded MRAID placements: 30 second max
- **Sources:** [AppLovin Creative Guidelines](https://support.axon.ai/en/growth/promoting-your-apps/creatives/best-practices-and-guidelines/), [2DKit Tutorial](https://2dkit.com/playable-ads/create-applovin-playable-ads-tutorial/)

### Unity Ads

- **CTA:** `mraid.open(url)` — iOS URLs must use `apps.apple.com/` domain
- **Size:** 5 MB (single inlined, minified HTML)
- **MRAID:** 2.0 (injected by Unity Ads webview, MRAID 3.0 partially supported)
- **Lifecycle:** Wait for `viewableChange(true)` before starting playable. Pause on `viewableChange(false)`
- **Audio:** Sound OFF by default. Physical mute button **must work** (rejection cause). Mute on background
- **Load time:** < 10 seconds
- **Network requests:** No XHR allowed
- **Redirects:** No auto-redirect to store. No delayed redirect (>7s after last interaction)
- **Close button:** Don't block — Unity provides its own
- **Sources:** [Unity Docs — Specifications](https://docs.unity.com/acquire/en-us/manual/playable-ads-specifications), [Unity Docs — Interactive Requirements](https://docs.unity.com/en-us/grow/is-ads/user-acquisition/creatives/interactive-requirements)

### ironSource (Unity LevelPlay)

**Supports TWO protocols (mutually exclusive — never mix!):**

#### DAPI Protocol (preferred)
- **CTA:** `dapi.openStoreUrl()` (no URL parameter — network handles it)
- **DAPI API:**
  - `dapi.isReady()` → boolean (**must call** — validated)
  - `dapi.addEventListener('ready', cb)` → wait for init
  - `dapi.getAudioVolume()` → 0-100 (**must call** — validated)
  - `dapi.getScreenSize()` → {width, height} (**must call** — validated)
  - `dapi.isViewable()` → boolean
  - `dapi.addEventListener('audioVolumeChange', cb)` (**must listen** — validated)
  - `dapi.addEventListener('viewableChange', cb)` → pause/resume
  - `dapi.addEventListener('adResized', cb)` → layout update
- **Lifecycle:** Check `isReady()` → get audio/screen → listen events → start when viewable

#### MRAID Protocol
- **CTA:** `mraid.open(URL_STRING)` (URL required)
- **MRAID:** 2.0 — `<script src="mraid.js"></script>` in `<head>`

#### Common
- **Size:** 5 MB (single HTML, all assets base64)
- **Audio:** Check `getAudioVolume()` on init. Mute when not viewable
- **Close button:** Don't add — ironSource renders timer + close button
- **URLs:** Must be absolute HTTPS
- **`window.open()`:** NOT supported
- **Sources:** [MRAID Requirements](https://developers.is.com/ironsource-mobile/general/mraid-requirements/), [MRAID Specs](https://developers.is.com/ironsource-mobile/general/mraid-specifications-guidelines/), [Test Tool](https://demos.ironsrc.com/test-tool/)

### Mintegral

- **CTA:** `window.install()` — SDK injects it at runtime
- **Size:** 5 MB (ZIP)
- **MRAID:** No
- **ZIP structure:** `{name}.zip` → `{name}/` → `{name}.html` (names must match). All assets inlined in HTML. **No config.json required.**
- **Lifecycle (ALL required, validated by Mindworks):**
  1. Game loads → calls `window.gameReady()` (signal to SDK)
  2. SDK calls `gameStart()` (must be defined as global function)
  3. Player finishes → game calls `window.gameEnd()`
  4. Game shows endcard → CTA click: `window.install()` + `window.gameClose()`
- **Mindworks validator checks:** download logic (install), gameEnd, gameReady, gameStart function, gameClose function, file size, ZIP structure, JS errors
- **Note:** `gameStart` and `gameClose` must be **top-level global functions** (validator calls them)
- **Sources:** [Mintegral Playable Guide](https://adv-new.mintegral.com/doc/en/creatives/playable.html), [Mindworks Review](https://www.mindworks-creative.com/review/)

### TikTok / Pangle

- **CTA:** `playableSDK.openAppStore()` or `window.openAppStore()`
- **SDK:** `https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js` — in `<body>` before custom JS
- **Size:** 5 MB (ZIP, compressed)
- **MRAID:** No — **forbidden**
- **ZIP structure:** `index.html` + `config.json` at root
- **config.json (required):**
  ```json
  {"playable_orientation": 0, "playable_languages": ["en"]}
  ```
  - `playable_orientation`: 0=responsive, 1=portrait, 2=landscape
- **Lifecycle:** `gameReady()` → SDK calls `gameStart()` → game ends → `gameClose()`
- **Duration:** 10–30 seconds recommended
- **Blocked:** No HTTP requests, no mraid.js, no JS redirects
- **Note:** SDK URLs in codebase use old `pstatp.com` CDN — current official is `ibytedtos.com`
- **Sources:** [TikTok Ads Help](https://ads.tiktok.com/help/article/playable-ads), [Luna Labs](https://docs.lunalabs.io/docs/playable/ad-networks/tiktok/)

### Vungle (Liftoff Monetize)

**Two modes:**

#### Adaptive Creative (self-serve Dashboard)
- **CTA:** `parent.postMessage('download', '*')`
- **Complete event:** `parent.postMessage('complete', '*')` — when user reaches milestone
- **MRAID:** No
- **Rules:** `download` and `complete` must NEVER fire simultaneously. `complete` must NOT be tied to click

#### MRAID via Exchange (DSP)
- **CTA:** `mraid.open(url)` or `window.open(url)` (NOT `window.location`)
- **MRAID:** 2.0 — bid response requires `"crtype": "MRAID 2.0"`

#### Common
- **Size:** 5 MB (ZIP)
- **ZIP structure:** `index.html` at root (NOT `ad.html` — Creative Verifier rejects it)
- **Validator checks:** presence of `index.html`, `download` event, `complete` event, file size, ZIP structure
- **Sources:** [Creative Asset Requirements](https://support.vungle.com/hc/en-us/articles/360057064312), [Creative Verifier](https://vungle.com/creative-verifier/), [Dos and Don'ts](https://support.vungle.com/hc/en-us/articles/360056663752)

### Bigo Ads

- **CTA:** `BGY_MRAID.open(url)`
- **SDK:** `https://static-web.likeevideo.com/as/common-static/big-data/dsp-public/bgy-mraid-sdk.js`
- **Size:** 5 MB (ZIP)
- **MRAID:** No (own SDK — BGY_MRAID)

---

## CTA Methods Summary

| Method | Networks |
|--------|---------|
| `mraid.open(url)` | AppLovin, Unity, ironSource (MRAID mode), AdColony, Appreciate, Chartboost, Liftoff, Adikteev, Bigabid, inMobi, Snapchat |
| `dapi.openStoreUrl()` | ironSource (DAPI mode) |
| `FbPlayableAd.onCTAClick()` | Facebook/Meta, Moloco |
| `ExitApi.exit()` | Google Ads |
| `Enabler.exit(name)` | Google DV360 |
| `playableSDK.openAppStore()` | TikTok, Pangle |
| `window.install()` | Mintegral |
| `parent.postMessage('download','*')` | Vungle (Adaptive) |
| `BGY_MRAID.open(url)` | Bigo |
| `MTRG.onCTAClick()` | myTarget (VK Ads) |
| `yandexHTML5BannerApi.getClickURLNum(1)` | Yandex |
| `window.open()` | Fallback for all |

## SDK/Script Injection

| Network | Injected Script |
|---------|----------------|
| MRAID networks | `<script src="mraid.js"></script>` in `<head>` |
| Google Ads | `<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>` |
| Google DV360 | `<script src="https://s0.2mdn.net/ads/studio/Enabler.js"></script>` |
| TikTok/Pangle | `<script src="https://sf16-muse-va.ibytedtos.com/obj/union-fe-nc-i18n/playable/sdk/playable-sdk.js"></script>` |
| Bigo | `<script src="https://static-web.likeevideo.com/as/common-static/big-data/dsp-public/bgy-mraid-sdk.js"></script>` |

## Special ZIP Structures

| Network | ZIP Structure |
|---------|--------------|
| Mintegral | `{name}/{name}.html` (names must match) |
| TikTok/Pangle | `index.html` + `config.json` (orientation + languages) |
| Snapchat | `index.html` + `config.json` (orientation) |
| Google Ads | `index.html` + assets (relative paths) |
| Vungle | `index.html` at root (flat) |
| Standard ZIP | `index.html` + assets (flat) |

---

## Critical Rules (ALL Networks)

1. **Always call `game_end()` / `sdk.finish()`** — networks reject creatives without it
2. **Set store URLs via SDK** before CTA
3. **Load time < 1–3 seconds** (Unity allows up to 10s)
4. **Responsive design** — both orientations when possible
5. **Test in official validator** before submission
6. **No external network requests** — all assets inline
7. **No auto-play audio** — check audio state, respect mute, respect physical mute button
8. **No custom close button** — networks provide their own (AppLovin, Unity, ironSource)

## Validators Quick Reference

| Network | Validator URL |
|---------|-------------|
| Facebook | https://developers.facebook.com/tools/playable-preview/ |
| Google | https://h5validator.appspot.com/dcm/asset (deprecated Apr 2025) |
| AppLovin | https://p.applov.in/playablePreview?create=1&qr=1 |
| Unity | iOS/Android Ad Testing app |
| ironSource | https://demos.ironsrc.com/test-tool/ (deprecated) |
| Mintegral | https://www.mindworks-creative.com/review/ |
| Vungle | https://vungle.com/creative-verifier/ |

## Tools

- [PlayableTools](https://tools.gritsenko.biz/) — publishing, asset compression, network requirements
- [@smoud/playable-sdk](https://github.com/smoudjs/playable-sdk) — universal SDK for 21 networks
- [@smoud/playable-scripts](https://github.com/smoudjs/playable-scripts) — CLI for network-specific builds
- [super-html](https://store.cocos.com/app/detail/3657) — Cocos Creator packaging tool
- [cocos-playable-demo](https://github.com/magician-f/cocos-playable-demo) — Cocos Creator 3.5+ reference

---

## Codebase Discrepancies Found

| Issue | Current | Should Be |
|-------|---------|-----------|
| Facebook maxSize | 5 MB | **2 MB** (HTML) / 5 MB (ZIP) — need dual limits |
| TikTok/Pangle maxSize | 4 MB | **5 MB** (official) |
| Yandex maxSize | 5 MB | **3 MB** — **FIXED** |
| Vungle CTA mock | none | **`parent.postMessage('download','*')`** — **FIXED** |
| myTarget CTA mock | none | **`MTRG.onCTAClick()`** — **FIXED** |
| Yandex CTA mock | none | **`yandexHTML5BannerApi.getClickURLNum(1)`** — **FIXED** |
| ironSource protocol | MRAID only | **DAPI + MRAID** (mutually exclusive) |
| TikTok SDK URL | `pstatp.com` (old CDN) | `ibytedtos.com` (current) — needs update |
| Unity MRAID | 3.0 in config | **2.0** (3.0 partially supported) |

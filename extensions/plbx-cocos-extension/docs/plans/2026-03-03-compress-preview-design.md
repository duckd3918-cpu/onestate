# Compress Preview Overlay

## Decision
CSS modal overlay inside the existing panel (Approach A).
No second Editor panel registration needed.

## Layout

### Images
```
┌──────────────────────────────────────────────────┐
│ [x] Preview: texture_hero.png                    │
├────────────────────┬─────────────────────────────┤
│   ORIGINAL         │   COMPRESSED               │
│   ┌───────────┐    │   ┌───────────┐            │
│   │  <img>    │    │   │  <img>    │            │
│   └───────────┘    │   └───────────┘            │
│   512×512 PNG      │   512×512 WebP             │
│   245 KB           │   48 KB (−80%)             │
├────────────────────┴─────────────────────────────┤
│ Format: [WebP ▾]  Quality: ──●──── [80]         │
│        [ Apply ]          [ Cancel ]             │
└──────────────────────────────────────────────────┘
```

### Audio
```
┌──────────────────────────────────────────────────┐
│ [x] Preview: sfx_click.wav                       │
├────────────────────┬─────────────────────────────┤
│ ORIGINAL           │ COMPRESSED                  │
│ ▶ ━━━━●━━━━ 0:03  │ ▶ ━━━━●━━━━ 0:03           │
│ WAV 44.1kHz 16bit  │ MP3 128kbps                │
│ 1.2 MB             │ 48 KB (−96%)               │
├────────────────────┴─────────────────────────────┤
│ Format: [MP3 ▾]   Quality: ──●──── [128kbps]    │
│        [ Apply ]          [ Cancel ]             │
└──────────────────────────────────────────────────┘
```

## Components
1. Overlay backdrop — semi-transparent, click = close
2. Modal card — ~80% of panel, centered
3. Header — filename + close button
4. Side-by-side — original left, compressed right
5. Controls — format select, quality slider (debounce 500ms)
6. Actions — Apply (compress & replace), Cancel

## Behavior
- Open: click row or Preview button in compress table
- Live preview: format/quality change → 500ms debounce → compress-image-preview → update right side
- Apply: compress-image (real), update table row, close
- Cancel / Escape / backdrop click: close without changes
- Audio: compress-audio-preview, data URI for <audio>

## Backend endpoints
Existing:
- get-image-meta → { width, height, format, size, channels }
- compress-image-preview → { dataUri, metadata }
- compress-image → CompressionResult

New needed:
- get-asset-data-uri(path) — file → data URI for original display
- compress-audio-preview(path, format, quality) — audio preview as data URI

## UX fixes (also in scope)
1. Build size: show packaged HTML size, not total source assets
2. Deduplicate asset list (by path)
3. Compress tab: filter to images/audio only
4. Separate content types or add type filter

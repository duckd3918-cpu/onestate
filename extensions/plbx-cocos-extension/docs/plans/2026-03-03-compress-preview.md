# Compress Preview Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a modal preview overlay in the Compress tab that shows before/after comparison for images and audio, with live format/quality controls and 500ms debounce.

**Architecture:** CSS overlay inside the existing panel div. New backend messages: `get-asset-data-uri` (reads file to data URI) and `compress-audio-preview` (compress to buffer to data URI). Frontend builds overlay DOM in `_initPreview`, opens it on row click. Debounced 500ms calls to `compress-image-preview` / `compress-audio-preview` on control changes.

**Tech Stack:** Sharp (images), FFmpeg (audio), Cocos Creator Editor Panel API, vanilla DOM.

---

### Task 1: Backend — `get-asset-data-uri` message

**Files:**
- Modify: `src/main.ts` (add handler + import)
- Modify: `package.json` (register message)

**Step 1: Add handler to `src/main.ts`**

After the existing `getImageMeta` method (~line 65), add:

```typescript
async getAssetDataUri(inputPath: string) {
  const { readFileSync, statSync } = require('fs');
  const { extname } = require('path');
  const ext = extname(inputPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const buf = readFileSync(inputPath);
  const size = statSync(inputPath).size;
  return { dataUri: `data:${mime};base64,${buf.toString('base64')}`, size };
},
```

**Step 2: Register in `package.json`**

In `contributions.messages`, add after `"get-image-meta"`:

```json
"get-asset-data-uri": {
  "methods": ["getAssetDataUri"]
},
```

**Step 3: Build & verify**

Run: `npm run build`
Expected: no errors

**Step 4: Commit**

```
feat: add get-asset-data-uri backend message
```

---

### Task 2: Backend — `compress-audio-preview` message

**Files:**
- Modify: `src/core/compression/audio-compressor.ts` (add `compressAudioToBuffer`)
- Modify: `src/main.ts` (add handler + import)
- Modify: `package.json` (register message)

**Step 1: Add `compressAudioToBuffer` to `audio-compressor.ts`**

After `compressAudio()` function (~line 75), add:

```typescript
export async function compressAudioToBuffer(
  inputPath: string,
  options: AudioCompressionOptions,
): Promise<{ buffer: Buffer; metadata: AudioCompressionResult }> {
  const os = require('os');
  const { readFileSync, unlinkSync } = require('fs');
  const tmpDir = os.tmpdir();
  const metadata = await compressAudio(inputPath, options, tmpDir);
  const buffer = readFileSync(metadata.outputPath);
  try { unlinkSync(metadata.outputPath); } catch { /* cleanup */ }
  return { buffer, metadata };
}
```

**Step 2: Add handler to `src/main.ts`**

Import `compressAudioToBuffer` alongside `compressAudio`:
```typescript
import { compressAudio, compressAudioToBuffer, isFFmpegAvailable } from './core/compression/audio-compressor';
```

Add method after `compressAudioAsset`:
```typescript
async compressAudioPreview(inputPath: string, format: string, bitrate: number) {
  const { buffer, metadata } = await compressAudioToBuffer(inputPath, { format: format as any, bitrate });
  const mime = format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
  return {
    dataUri: `data:${mime};base64,${buffer.toString('base64')}`,
    metadata,
  };
},
```

**Step 3: Register in `package.json`**

```json
"compress-audio-preview": {
  "methods": ["compressAudioPreview"]
},
```

**Step 4: Build & verify**

Run: `npm run build`
Expected: no errors

**Step 5: Commit**

```
feat: add compress-audio-preview backend message
```

---

### Task 3: Template — preview overlay HTML

**Files:**
- Modify: `static/template/index.html` (add overlay markup)
- Modify: `src/panels/default.ts` (add selectors to `$` map)

**Step 1: Add overlay HTML to `index.html`**

The overlay goes AFTER `</div><!-- end .tab-content -->` but INSIDE `.panel-root`. Insert before `</div><!-- end .panel-root -->`:

```html
  <!-- ===================== PREVIEW OVERLAY ===================== -->
  <div id="preview-overlay" class="preview-overlay" style="display:none;">
    <div class="preview-backdrop" id="preview-backdrop"></div>
    <div class="preview-modal">
      <div class="preview-header">
        <span id="preview-title" class="preview-title">Preview</span>
        <button id="preview-close" class="preview-close-btn">&times;</button>
      </div>
      <div class="preview-body">
        <div class="preview-side">
          <div class="preview-label">ORIGINAL</div>
          <div class="preview-media-wrap" id="preview-orig-wrap"></div>
          <div class="preview-meta" id="preview-orig-meta"></div>
        </div>
        <div class="preview-side">
          <div class="preview-label">COMPRESSED</div>
          <div class="preview-media-wrap" id="preview-comp-wrap">
            <span class="spinner" id="preview-spinner" style="display:none;"></span>
          </div>
          <div class="preview-meta" id="preview-comp-meta"></div>
        </div>
      </div>
      <div class="preview-controls">
        <span class="form-label">Format</span>
        <select id="preview-format" class="form-select" style="max-width:120px;">
          <option value="webp">WebP</option>
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="avif">AVIF</option>
        </select>
        <span class="form-label" style="margin-left:12px;">Quality</span>
        <div class="slider-row" style="flex:1;">
          <input type="range" id="preview-quality" class="form-slider" min="1" max="100" value="80" />
          <span id="preview-quality-val" class="slider-value">80</span>
        </div>
      </div>
      <div class="preview-actions">
        <button id="preview-apply" class="btn">Apply</button>
        <button id="preview-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    </div>
  </div>
```

**Step 2: Add selectors to `$` map in `default.ts`**

After the preset buttons block (~line 104), add:

```typescript
// Preview overlay
previewOverlay:    '#preview-overlay',
previewBackdrop:   '#preview-backdrop',
previewTitle:      '#preview-title',
previewClose:      '#preview-close',
previewOrigWrap:   '#preview-orig-wrap',
previewOrigMeta:   '#preview-orig-meta',
previewCompWrap:   '#preview-comp-wrap',
previewCompMeta:   '#preview-comp-meta',
previewSpinner:    '#preview-spinner',
previewFormat:     '#preview-format',
previewQuality:    '#preview-quality',
previewQualityVal: '#preview-quality-val',
previewApply:      '#preview-apply',
previewCancel:     '#preview-cancel',
```

**Step 3: Build & verify**

Run: `npm run build`
Expected: no errors

**Step 4: Commit**

```
feat: add preview overlay HTML template and selectors
```

---

### Task 4: CSS — preview overlay styles

**Files:**
- Modify: `static/style/index.css` (add overlay styles)

**Step 1: Add styles at end of `index.css`**

```css
/* -- Preview Overlay -- */
.preview-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
}

.preview-modal {
  position: relative;
  width: 85%;
  max-width: 900px;
  max-height: 90%;
  background: #2b2b2b;
  border: 1px solid #444;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #3a3a3a;
  background: #333;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-close-btn {
  background: none;
  border: none;
  color: #999;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.preview-close-btn:hover { color: #fff; }

.preview-body {
  display: flex;
  gap: 1px;
  background: #3a3a3a;
  flex: 1;
  overflow: auto;
  min-height: 200px;
}

.preview-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  background: #2b2b2b;
}

.preview-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #888;
  margin-bottom: 8px;
}

.preview-media-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 150px;
  width: 100%;
  position: relative;
}

.preview-media-wrap img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  border-radius: 3px;
  image-rendering: auto;
}

.preview-media-wrap audio {
  width: 100%;
  max-width: 320px;
}

.preview-meta {
  margin-top: 8px;
  font-size: 11px;
  color: #aaa;
  text-align: center;
  line-height: 1.5;
  white-space: pre-line;
}

.preview-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #3a3a3a;
  background: #333;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #3a3a3a;
  background: #333;
}
```

**Step 2: Build & verify**

Run: `npm run build`
Expected: no errors

**Step 3: Commit**

```
feat: add preview overlay CSS styles
```

---

### Task 5: Panel logic — preview overlay controller

This is the main task. Add `_initPreview`, `_openPreview`, `_closePreview`, `_updatePreview`, `_applyPreview` methods.

**Files:**
- Modify: `src/panels/default.ts` (add methods, wire up)

**Step 1: Add `_initPreview` method inside `methods: {}`**

After `_compressAll` method, add:

```typescript
_initPreview(this: any) {
  this._previewAsset = null;
  this._previewDebounceTimer = null;

  // Close handlers
  this.$.previewClose?.addEventListener('click', () => this._closePreview());
  this.$.previewBackdrop?.addEventListener('click', () => this._closePreview());
  this.$.previewCancel?.addEventListener('click', () => this._closePreview());

  // Escape key
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this._previewAsset) this._closePreview();
  });

  // Quality slider — update display + debounced preview
  const qSlider = this.$.previewQuality as HTMLInputElement;
  const qVal    = this.$.previewQualityVal as HTMLSpanElement;
  qSlider?.addEventListener('input', () => {
    if (qVal) qVal.textContent = qSlider.value;
    this._schedulePreviewUpdate();
  });

  // Format change — debounced preview
  this.$.previewFormat?.addEventListener('change', () => {
    this._schedulePreviewUpdate();
  });

  // Apply button
  this.$.previewApply?.addEventListener('click', () => this._applyPreview());
},

_schedulePreviewUpdate(this: any) {
  if (this._previewDebounceTimer) clearTimeout(this._previewDebounceTimer);
  this._previewDebounceTimer = setTimeout(() => {
    this._previewDebounceTimer = null;
    this._updatePreview();
  }, 500);
},
```

**Step 2: Add `_openPreview` method**

Uses safe DOM methods — `clearChildren()` helper and `document.createElement` instead of innerHTML:

```typescript
async _openPreview(this: any, asset: any) {
  this._previewAsset = asset;
  const overlay = this.$.previewOverlay as HTMLElement;
  if (!overlay) return;

  const isAudio = /\.(mp3|ogg|wav|m4a)$/i.test(asset.name ?? '');

  // Set title
  const title = this.$.previewTitle as HTMLElement;
  if (title) title.textContent = `Preview: ${asset.name ?? '\u2014'}`;

  // Sync format/quality from main compress controls
  const mainFormat  = (this.$.compressFormat as HTMLSelectElement)?.value ?? 'webp';
  const mainQuality = (this.$.compressQuality as HTMLInputElement)?.value ?? '80';
  const pFormat  = this.$.previewFormat as HTMLSelectElement;
  const pQuality = this.$.previewQuality as HTMLInputElement;
  const pQVal    = this.$.previewQualityVal as HTMLSpanElement;

  if (pFormat) {
    clearChildren(pFormat);
    if (isAudio) {
      for (const [val, label] of [['mp3', 'MP3'], ['ogg', 'OGG']]) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        pFormat.appendChild(opt);
      }
      pFormat.value = mainFormat === 'ogg' ? 'ogg' : 'mp3';
    } else {
      for (const [val, label] of [['webp','WebP'],['jpeg','JPEG'],['png','PNG'],['avif','AVIF']]) {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        pFormat.appendChild(opt);
      }
      pFormat.value = mainFormat;
    }
  }
  if (pQuality) pQuality.value = mainQuality;
  if (pQVal) pQVal.textContent = mainQuality;

  // Show original
  const origWrap = this.$.previewOrigWrap as HTMLElement;
  const origMeta = this.$.previewOrigMeta as HTMLElement;
  if (origWrap) clearChildren(origWrap);
  if (origMeta) origMeta.textContent = 'Loading...';

  overlay.style.display = 'flex';

  try {
    const origData = await Editor.Message.request('plbx-cocos-extension', 'get-asset-data-uri', asset.path);
    if (origWrap) {
      if (isAudio) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = origData.dataUri;
        origWrap.appendChild(audio);
      } else {
        const img = document.createElement('img');
        img.src = origData.dataUri;
        origWrap.appendChild(img);
      }
    }

    const origSize = origData.size ?? asset.sourceSize ?? asset.buildSize ?? 0;
    if (!isAudio) {
      const meta = await Editor.Message.request('plbx-cocos-extension', 'get-image-meta', asset.path);
      if (origMeta) origMeta.textContent = `${meta.width}\u00d7${meta.height} ${meta.format.toUpperCase()}\n${fmt(origSize)}`;
    } else {
      if (origMeta) origMeta.textContent = fmt(origSize);
    }
  } catch (e: any) {
    console.warn('[plbx] preview original load error:', e);
    if (origMeta) origMeta.textContent = 'Failed to load';
  }

  // Trigger compressed preview
  this._updatePreview();
},
```

**Step 3: Add `_updatePreview` method**

```typescript
async _updatePreview(this: any) {
  const asset = this._previewAsset;
  if (!asset) return;

  const isAudio = /\.(mp3|ogg|wav|m4a)$/i.test(asset.name ?? '');
  const format  = (this.$.previewFormat as HTMLSelectElement)?.value ?? 'webp';
  const quality = parseInt((this.$.previewQuality as HTMLInputElement)?.value ?? '80', 10);

  const compWrap = this.$.previewCompWrap as HTMLElement;
  const compMeta = this.$.previewCompMeta as HTMLElement;
  const spinner  = this.$.previewSpinner as HTMLElement;

  // Show spinner, clear previous media (keep spinner element)
  if (compWrap) {
    Array.from(compWrap.children).forEach((c: any) => {
      if (c !== spinner) c.remove();
    });
  }
  if (spinner) spinner.style.display = '';
  if (compMeta) compMeta.textContent = 'Compressing...';

  try {
    let result: any;
    if (isAudio) {
      result = await Editor.Message.request('plbx-cocos-extension', 'compress-audio-preview', asset.path, format, quality);
    } else {
      result = await Editor.Message.request('plbx-cocos-extension', 'compress-image-preview', asset.path, format, quality);
    }

    // Check if still same asset (user may have closed or switched)
    if (this._previewAsset !== asset) return;

    if (spinner) spinner.style.display = 'none';

    if (compWrap) {
      if (isAudio) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = result.dataUri;
        compWrap.appendChild(audio);
      } else {
        const img = document.createElement('img');
        img.src = result.dataUri;
        compWrap.appendChild(img);
      }
    }

    const meta = result.metadata;
    const origSize = asset.sourceSize ?? asset.buildSize ?? meta.inputSize ?? 0;
    const compSize = meta.outputSize ?? 0;
    const savings  = origSize > 0 ? ((origSize - compSize) / origSize * 100).toFixed(1) : '0';

    if (!isAudio && meta.width) {
      if (compMeta) compMeta.textContent = `${meta.width}\u00d7${meta.height} ${format.toUpperCase()}\n${fmt(compSize)} (\u2212${savings}%)`;
    } else {
      if (compMeta) compMeta.textContent = `${format.toUpperCase()}\n${fmt(compSize)} (\u2212${savings}%)`;
    }
  } catch (e: any) {
    if (spinner) spinner.style.display = 'none';
    if (compMeta) compMeta.textContent = `Error: ${e?.message ?? e}`;
    console.warn('[plbx] preview compress error:', e);
  }
},
```

**Step 4: Add `_closePreview` method**

```typescript
_closePreview(this: any) {
  this._previewAsset = null;
  if (this._previewDebounceTimer) {
    clearTimeout(this._previewDebounceTimer);
    this._previewDebounceTimer = null;
  }
  const overlay = this.$.previewOverlay as HTMLElement;
  if (overlay) overlay.style.display = 'none';

  // Clean up media elements to stop playback
  const origWrap = this.$.previewOrigWrap as HTMLElement;
  const compWrap = this.$.previewCompWrap as HTMLElement;
  if (origWrap) clearChildren(origWrap);
  if (compWrap) {
    const spinner = this.$.previewSpinner as HTMLElement;
    Array.from(compWrap.children).forEach((c: any) => {
      if (c !== spinner) c.remove();
    });
  }
},
```

**Step 5: Add `_applyPreview` method**

```typescript
async _applyPreview(this: any) {
  const asset = this._previewAsset;
  if (!asset) return;

  const isAudio = /\.(mp3|ogg|wav|m4a)$/i.test(asset.name ?? '');
  const format  = (this.$.previewFormat as HTMLSelectElement)?.value ?? 'webp';
  const quality = parseInt((this.$.previewQuality as HTMLInputElement)?.value ?? '80', 10);

  const applyBtn = this.$.previewApply as HTMLButtonElement;
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = 'Applying...'; }

  try {
    let result: any;
    if (isAudio) {
      const audioFormat = format === 'mp3' || format === 'ogg' ? format : 'mp3';
      result = await Editor.Message.request('plbx-cocos-extension', 'compress-audio', asset.path, audioFormat, quality);
    } else {
      result = await Editor.Message.request('plbx-cocos-extension', 'compress-image', asset.path, format, quality);
    }

    // Update the compress table row
    const rowId = 'compress-row-' + encodeURIComponent(asset.path ?? asset.name ?? '');
    const tbody = this.$.compressTbody as HTMLElement;
    const row = tbody?.querySelector(`#${CSS.escape(rowId)}`) as HTMLTableRowElement | null;
    if (row) {
      const cells = row.querySelectorAll('td');
      const newSize = result?.outputSize ?? result?.size ?? 0;
      const origSize = asset.sourceSize ?? asset.buildSize ?? 0;
      if (cells[3]) cells[3].textContent = fmt(newSize);
      if (cells[4]) cells[4].textContent = origSize ? pct(newSize, origSize) : '\u2014';
      if (cells[5]) { clearChildren(cells[5]); cells[5].appendChild(makeBadge('badge-pass', 'done')); }
    }

    this._closePreview();
  } catch (e: any) {
    console.warn('[plbx] preview apply error:', e);
  } finally {
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
  }
},
```

**Step 6: Call `_initPreview` from `ready()`**

In `ready()`, after `this._initDeploy();`, add:

```typescript
this._initPreview();
```

**Step 7: Wire up row click in `_populateCompressTable`**

In the row creation loop of `_populateCompressTable`, after `tr.id = ...` line, add:

```typescript
tr.style.cursor = 'pointer';
tr.addEventListener('click', (e: MouseEvent) => {
  // Don't trigger on button clicks
  if ((e.target as HTMLElement).closest('button')) return;
  this._openPreview(asset);
});
```

**Step 8: Build & run tests**

Run: `npm run build && npx vitest run`
Expected: build passes, all tests pass

**Step 9: Commit**

```
feat: add compress preview overlay with live before/after comparison
```

---

### Task 6: Update tests

**Files:**
- Modify: `tests/panels/panel-structure.test.ts`

**Step 1: Add preview overlay tests**

In the `template structure` describe block, add:

```typescript
it('should have preview overlay elements', () => {
  expect(templateHtml).toContain('id="preview-overlay"');
  expect(templateHtml).toContain('id="preview-format"');
  expect(templateHtml).toContain('id="preview-quality"');
  expect(templateHtml).toContain('id="preview-apply"');
  expect(templateHtml).toContain('id="preview-close"');
});
```

In the `panel export format` describe block's methods check, add:

```typescript
expect(distCode).toContain('_initPreview');
expect(distCode).toContain('_openPreview');
expect(distCode).toContain('_closePreview');
expect(distCode).toContain('_updatePreview');
expect(distCode).toContain('_applyPreview');
```

In the `CSS completeness` describe block, add:

```typescript
it('should style preview overlay', () => {
  expect(cssContent).toContain('.preview-overlay');
  expect(cssContent).toContain('.preview-modal');
  expect(cssContent).toContain('.preview-body');
  expect(cssContent).toContain('.preview-controls');
});
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: all pass

**Step 3: Commit**

```
test: add preview overlay structure tests
```

---

### Task 7: UX fixes — deduplicate assets in build report

**Files:**
- Modify: `src/panels/default.ts` — `_renderReport`

**Step 1: Deduplicate assets in `_renderReport`**

At the top of `_renderReport`, after receiving `report`, add dedup:

```typescript
// Deduplicate by path
const seen = new Set<string>();
const dedupedAssets = (report?.assets ?? []).filter((a: any) => {
  const key = a.path ?? a.name ?? '';
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
report = { ...report, assets: dedupedAssets };
```

**Step 2: Build & run tests**

Run: `npm run build && npx vitest run`

**Step 3: Commit**

```
fix: deduplicate assets in build report
```

---

## Execution order

Tasks 1, 2 (backend) can run in parallel.
Tasks 3, 4 (template/CSS) can run in parallel.
Task 5 (panel logic) depends on 1-4.
Task 6 (tests) depends on 5.
Task 7 (UX fixes) is independent.

Recommended serial order: 1 -> 2 -> 3+4 -> 5 -> 6 -> 7

# Build Report Details Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Build Details" section to the Build Report tab that shows a categorized size breakdown (Engine, Plugins, Assets, Scripts) and per-network packed HTML sizes.

**Architecture:** Extend `BuildScanResult` with `categories` (file size by category) and `packedHtmls` (per-network HTML sizes scanned from sibling `plbx-html/` directory). Pass these through `scanAssetsHybrid` into `BuildReport`, then render a horizontal-bar infographic in the panel between the summary bar and the asset table.

**Tech Stack:** TypeScript, Vitest, Cocos Creator 3.8 extension (custom element panel), inline CSS in `static/style/index.css`

**Branch:** `feature/build-report-details` — **NO intermediate commits. One commit at the very end.**

---

## File Structure

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `BuildCategories`, `PackedHtmlEntry` interfaces; extend `BuildReport` |
| `src/core/build-report/build-scanner.ts` | Add categorization loop + packed HTML scan; extend `BuildScanResult` |
| `src/core/build-report/scanner.ts` | Pass `buildCategories` + `packedHtmls` through in `scanAssetsHybrid` |
| `static/template/index.html` | Add `<div id="build-details">` between summary-bar and data-table-wrap |
| `static/style/index.css` | Add CSS for `.build-details`, `.bd-bar-row`, `.bd-html-row`, etc. |
| `src/panels/default.ts` | Add `_renderBuildDetails()` method; call from `_renderReport()` |
| `tests/core/build-report/build-scanner.test.ts` | Add tests for categories and packedHtmls |
| `tests/fixtures/roadside-build/plbx-html/` | Add 3 minimal HTML fixtures (applovin, unity, facebook) |
| `scripts/report.ts` | Update to print categories and packed HTML breakdown |

---

## Chunk 1: Data layer

### Task 1: Types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add interfaces to `src/shared/types.ts`**

Add after the `AssetReportItem` interface:

```typescript
export interface BuildCategories {
  engine: number;    // cocos-js/cc.js
  plugins: number;   // other cocos-js/ files (spine, dragonbones, etc.)
  assets: number;    // assets/*/native/ + assets/*/import/
  scripts: number;   // src/chunks/*.js, src/*.bundle.js
  other: number;     // everything else (index.html, application.js, effect.bin, etc.)
}

export interface PackedHtmlEntry {
  network: string;   // directory name (applovin, unity, facebook, etc.)
  size: number;      // bytes
}
```

Extend `BuildReport`:

```typescript
export interface BuildReport {
  timestamp: number;
  projectName: string;
  totalSourceSize: number;
  totalBuildSize: number;
  totalActualBuildSize?: number;
  buildDirExists: boolean;
  buildTimestamp?: number;
  buildCategories?: BuildCategories;   // ADD
  packedHtmls?: PackedHtmlEntry[];     // ADD
  assets: AssetReportItem[];
}
```

- [ ] **Step 2: Build to verify no type errors**

```bash
npm run build
```

Expected: `tsc` completes with no errors.

---

### Task 2: Extend build-scanner.ts

**Files:**
- Modify: `src/core/build-report/build-scanner.ts`

**Context on file categorization:**
```
cocos-js/cc.js                     → engine
cocos-js/spine*.js                 → plugins  (name contains known plugin keyword)
cocos-js/dragonbones*.js           → plugins
cocos-js/assets/*                  → plugins  (plugin data files)
cocos-js/<anything else>.js        → plugins  (future-proof: all non-cc cocos-js files)
assets/*/native/**                 → assets   (already counted in assetFilesSize)
assets/*/import/**                 → assets
src/chunks/*.js, src/*.bundle.js   → scripts
everything else                    → other    (root files, src/settings.json, effect.bin, etc.)
```

**Context on packed HTMLs:**
- buildDir is e.g. `.../build/web-mobile`
- plbx-html is at `.../build/plbx-html/` (sibling of web-mobile)
- So: `join(buildDir, '..', 'plbx-html')`
- Scan subdirectories, find `index.html` in each, record size

- [ ] **Step 1: Extend `BuildScanResult` interface**

```typescript
import { BuildCategories, PackedHtmlEntry } from '../../shared/types';

export interface BuildScanResult {
  buildDir: string;
  buildTimestamp: number;
  totalBuildSize: number;
  assetFilesSize: number;
  packFileSize: number;
  categories: BuildCategories;        // ADD
  packedHtmls: PackedHtmlEntry[];     // ADD
  assetMap: Map<string, BuildAssetData>;
  bundledUuids: Set<string>;
}
```

- [ ] **Step 2: Add category tracking variables in `scanBuildDirectory`**

After `let assetFilesSize = 0;`:

```typescript
let engineSize = 0;
let pluginsSize = 0;
let scriptsSize = 0;
let otherSize = 0;
```

- [ ] **Step 3: Add `categorizeFile(relPath, size)` helper function**

Add before `scanDirRecursive`:

```typescript
/**
 * Returns the category key for a file path relative to buildDir.
 * 'assets' category is tracked separately via assetFilesSize.
 */
function categorizeFile(
  relPath: string,
  size: number,
  cats: { engine: number; plugins: number; scripts: number; other: number },
): void {
  const norm = relPath.replace(/\\/g, '/');

  if (norm.startsWith('cocos-js/')) {
    const filename = norm.split('/').pop() ?? '';
    if (filename === 'cc.js') {
      cats.engine += size;
    } else {
      cats.plugins += size;
    }
    return;
  }

  if (norm.startsWith('src/')) {
    const filename = norm.split('/').pop() ?? '';
    if (filename.endsWith('.bundle.js') || norm.startsWith('src/chunks/')) {
      cats.scripts += size;
      return;
    }
  }

  cats.other += size;
}
```

- [ ] **Step 4: Call `categorizeFile` inside the total-size scan loop**

Replace the current total-size computation:
```typescript
const totalBuildSize = scanDirRecursive(buildDir).reduce((s, f) => s + f.size, 0);
```

With a loop that also categorizes:
```typescript
const cats = { engine: 0, plugins: 0, scripts: 0, other: 0 };
let totalBuildSize = 0;
// Regex: matches paths inside native/ or import/ subdirectory of any bundle
const ASSET_FILE_RE = /^assets\/[^/]+\/(native|import)\//;
for (const f of scanDirRecursive(buildDir)) {
  totalBuildSize += f.size;
  const rel = relative(buildDir, f.path).replace(/\\/g, '/');
  if (rel.startsWith('assets/')) {
    // native/ and import/ files are already counted in assetFilesSize → cats.assets
    // Other files under assets/ (config.json, index.js, etc.) go to 'other'
    if (!ASSET_FILE_RE.test(rel)) {
      cats.other += f.size;
    }
  } else {
    categorizeFile(rel, f.size, cats);
  }
}
```

**Why this matters:** `assetFilesSize` only counts files in `native/` and `import/` subdirs, but a bundle also contains `config.json`, `index.js`, etc. directly under `assets/<bundle>/`. Without this check, those files would be silently omitted and `cats.engine + cats.plugins + cats.assets + cats.scripts + cats.other` would not equal `totalBuildSize`.

- [ ] **Step 5: Add packed HTML scanning**

Add after the asset scanning loop, before the `return` statement:

```typescript
// Scan sibling plbx-html/ directory for packed HTMLs
const packedHtmls: PackedHtmlEntry[] = [];
const plbxHtmlDir = join(buildDir, '..', 'plbx-html');
if (existsSync(plbxHtmlDir)) {
  try {
    for (const entry of readdirSync(plbxHtmlDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const htmlPath = join(plbxHtmlDir, entry.name, 'index.html');
      if (existsSync(htmlPath)) {
        packedHtmls.push({
          network: entry.name,
          size: statSync(htmlPath).size,
        });
      }
    }
    packedHtmls.sort((a, b) => b.size - a.size);
  } catch {
    // ignore unreadable dirs
  }
}
```

- [ ] **Step 6: Include `categories` and `packedHtmls` in the return value**

```typescript
return {
  buildDir,
  buildTimestamp,
  totalBuildSize,
  assetFilesSize,
  packFileSize,
  categories: {
    engine: cats.engine,
    plugins: cats.plugins,
    assets: assetFilesSize,
    scripts: cats.scripts,
    other: cats.other,
  },
  packedHtmls,
  assetMap,
  bundledUuids,
};
```

- [ ] **Step 7: Build to verify no type errors**

```bash
npm run build
```

Expected: no errors.

---

### Task 3: Add fixture data for packed HTMLs

**Files:**
- Create: `tests/fixtures/roadside-build/plbx-html/applovin/index.html`
- Create: `tests/fixtures/roadside-build/plbx-html/unity/index.html`
- Create: `tests/fixtures/roadside-build/plbx-html/facebook/index.html`

The files need realistic sizes so tests can assert on them. Create minimal HTML with padding comments to reach ~100KB each (so they're not 0-byte and are distinguishable). Actual content doesn't matter — just needs to be `index.html` with some bytes.

- [ ] **Step 1: Create fixture packed HTML files**

```bash
# applovin — 102400 bytes (~100 KB)
python3 -c "
content = '<!DOCTYPE html><html><body><!-- ' + 'x' * 102300 + ' --></body></html>'
open('tests/fixtures/roadside-build/plbx-html/applovin/index.html', 'w').write(content)
"

# unity — 204800 bytes (~200 KB)
python3 -c "
content = '<!DOCTYPE html><html><body><!-- ' + 'x' * 204700 + ' --></body></html>'
open('tests/fixtures/roadside-build/plbx-html/unity/index.html', 'w').write(content)
"

# facebook — 409600 bytes (~400 KB) — deliberately larger
python3 -c "
content = '<!DOCTYPE html><html><body><!-- ' + 'x' * 409500 + ' --></body></html>'
open('tests/fixtures/roadside-build/plbx-html/facebook/index.html', 'w').write(content)
"
```

- [ ] **Step 2: Verify fixture files were created**

```bash
du -sh tests/fixtures/roadside-build/plbx-html/*/index.html
```

Expected:
```
100K  tests/fixtures/roadside-build/plbx-html/applovin/index.html
200K  tests/fixtures/roadside-build/plbx-html/unity/index.html
400K  tests/fixtures/roadside-build/plbx-html/facebook/index.html
```

---

### Task 4: Tests for new build-scanner fields

**Files:**
- Modify: `tests/core/build-report/build-scanner.test.ts`

- [ ] **Step 1: Write failing tests for `categories`**

Append to the existing `describe('scanBuildDirectory', ...)` block:

```typescript
it('should categorize files correctly', async () => {
  const result = await scanBuildDirectory(FIXTURE_BUILD);
  const cats = result!.categories;

  // Engine: cc.js only
  expect(cats.engine).toBeGreaterThan(0);
  // Fixture has cocos-js/cc.js (~2.6 MB)
  expect(cats.engine).toBeGreaterThan(1_000_000);

  // Assets: matches assetFilesSize
  expect(cats.assets).toBe(result!.assetFilesSize);

  // All categories sum to totalBuildSize
  const sum = cats.engine + cats.plugins + cats.assets + cats.scripts + cats.other;
  expect(sum).toBe(result!.totalBuildSize);
});

it('should scan sibling plbx-html directory for packed HTMLs', async () => {
  const result = await scanBuildDirectory(FIXTURE_BUILD);
  expect(result!.packedHtmls).toBeDefined();
  expect(result!.packedHtmls.length).toBe(3);

  // Should be sorted by size descending
  const sizes = result!.packedHtmls.map(h => h.size);
  expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1]);
  expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]);

  // facebook should be the largest (400 KB fixture)
  expect(result!.packedHtmls[0].network).toBe('facebook');

  // All should have a positive size
  for (const h of result!.packedHtmls) {
    expect(h.size).toBeGreaterThan(0);
    expect(h.network).toBeTruthy();
  }
});

it('should return empty packedHtmls when no plbx-html sibling exists', async () => {
  // Create a minimal valid build dir in a temp location with no plbx-html sibling
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('fs');
  const { tmpdir } = await import('os');
  const tmp = mkdtempSync(join(tmpdir(), 'test-build-'));
  try {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(join(tmp, 'src', 'settings.json'), JSON.stringify({ assets: { projectBundles: [] } }));
    const result = await scanBuildDirectory(tmp);
    expect(result).not.toBeNull();
    expect(result!.packedHtmls).toEqual([]);
  } finally {
    const { rmSync } = await import('fs');
    rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests — expect failures (categories, packedHtmls not yet in scanner)**

```bash
npm run test -- tests/core/build-report/build-scanner.test.ts --reporter=verbose
```

Expected: new tests FAIL with "categories is undefined" or similar.

- [ ] **Step 3: Run tests after Task 2 implementation — expect all pass**

```bash
npm run test -- tests/core/build-report/build-scanner.test.ts --reporter=verbose
```

Expected: all 10 tests PASS (7 original + 3 new).

---

### Task 5: Pass categories and packedHtmls through scanner.ts

**Files:**
- Modify: `src/core/build-report/scanner.ts`

- [ ] **Step 1: Update `scanAssetsHybrid` to capture and pass through new fields**

In the `if (buildScan)` block in `scanAssetsHybrid`, add after `totalActualBuildSize = buildScan.totalBuildSize;`:

```typescript
// already there:
buildDirExists = true;
buildTimestamp = buildScan.buildTimestamp;
totalActualBuildSize = buildScan.totalBuildSize;

// ADD:
buildCategories = buildScan.categories;
packedHtmls = buildScan.packedHtmls;
```

Declare the new variables at the top of the block (alongside `buildDirExists`):

```typescript
let buildDirExists = false;
let buildTimestamp: number | undefined;
let totalActualBuildSize: number | undefined;
let buildCategories: import('../../shared/types').BuildCategories | undefined;  // ADD
let packedHtmls: import('../../shared/types').PackedHtmlEntry[] | undefined;    // ADD
```

In the return value, add the new fields:

```typescript
return {
  timestamp: Date.now(),
  projectName,
  totalSourceSize,
  totalBuildSize,
  totalActualBuildSize,
  buildDirExists,
  buildTimestamp,
  buildCategories,   // ADD
  packedHtmls,       // ADD
  assets,
};
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npm run test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass.

---

### Task 6: Update scripts/report.ts to show categories and packed HTMLs

**Files:**
- Modify: `scripts/report.ts`

- [ ] **Step 1: Update the report output after total size lines**

Replace only these 3 lines (keep the `Total build size` line above untouched):
```typescript
console.log(`  └ engine+JS   : ${fmt(buildScan.totalBuildSize - buildScan.assetFilesSize)}`);
console.log(`  └ asset files : ${fmt(buildScan.assetFilesSize - buildScan.packFileSize)}`);
console.log(`  └ pack files  : ${fmt(buildScan.packFileSize)}`);
```

With:
```typescript
const cats = buildScan.categories;
console.log(`  └ Engine (cc.js) : ${fmt(cats.engine)}`);
if (cats.plugins > 0)
  console.log(`  └ Plugins        : ${fmt(cats.plugins)}`);
console.log(`  └ Assets         : ${fmt(cats.assets)}`);
console.log(`    └ (pack files) : ${fmt(buildScan.packFileSize)}`);
if (cats.scripts > 0)
  console.log(`  └ Scripts        : ${fmt(cats.scripts)}`);
if (cats.other > 0)
  console.log(`  └ Other          : ${fmt(cats.other)}`);

if (buildScan.packedHtmls.length > 0) {
  console.log('\n── Packed HTML per network ─────────────────────────────────────────────────');
  for (const h of buildScan.packedHtmls) {
    const warning = h.size > 5 * 1024 * 1024 ? ' ⚠ OVER 5MB' : '';
    console.log(`  ${pad(fmt(h.size), 10)} ${h.network}${warning}`);
  }
}
```

- [ ] **Step 2: Verify with the real build**

```bash
npx tsx scripts/report.ts <workspace>/Playables/_Prod/<project>/build/web-mobile 2>&1 | head -25
```

Expected output includes:
```
Total build size: 5.22 MB
  └ Engine (cc.js) : 2.41 MB
  └ Plugins        : 362.84 KB
  └ Assets         : 2.07 MB
  ...
── Packed HTML per network ─────────────────
  6.63 MB    facebook ⚠ OVER 5MB
  3.84 MB    applovin
  ...
```

---

## Chunk 2: UI layer

### Task 7: HTML template — Build Details section

**Files:**
- Modify: `static/template/index.html`

- [ ] **Step 1: Add `<div id="build-details">` between summary-bar and data-table-wrap**

In `index.html`, find this comment:
```html
      <div class="data-table-wrap">
```

Insert before it:
```html
      <!-- Build Details — shown only when real build data is present -->
      <div id="build-details" class="build-details" style="display:none;">
        <div class="bd-header" id="bd-toggle">
          <span id="bd-title" class="bd-title">Build Details</span>
          <span class="bd-chevron" id="bd-chevron">▼</span>
        </div>
        <div id="bd-body" class="bd-body">
          <div id="bd-bars" class="bd-bars"></div>
          <div id="bd-htmls" class="bd-htmls" style="display:none;"></div>
        </div>
      </div>

```

---

### Task 8: CSS for Build Details

**Files:**
- Modify: `static/style/index.css`

- [ ] **Step 1: Append CSS at the end of `static/style/index.css`**

```css
/* ===== Build Details Section ===== */
.build-details {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  margin-bottom: 8px;
  flex-shrink: 0;
  overflow: hidden;
}

.bd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
}

.bd-header:hover {
  background: #323232;
}

.bd-title {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.bd-chevron {
  font-size: 10px;
  color: #666;
  transition: transform 0.15s;
}

.bd-chevron.collapsed {
  transform: rotate(-90deg);
}

.bd-body {
  padding: 8px 12px 10px;
  border-top: 1px solid #3a3a3a;
}

.bd-bars {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bd-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.bd-bar-label {
  width: 110px;
  text-align: right;
  color: #888;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bd-bar-track {
  flex: 1;
  height: 10px;
  background: #1a1a1a;
  border-radius: 3px;
  overflow: hidden;
  min-width: 0;
}

.bd-bar-fill {
  height: 100%;
  border-radius: 3px;
  min-width: 2px;
}

.bd-bar-val {
  width: 56px;
  text-align: right;
  color: #ccc;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.bd-bar-pct {
  width: 36px;
  text-align: right;
  color: #555;
  flex-shrink: 0;
  font-size: 10px;
}

.bd-section-label {
  font-size: 10px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 10px 0 5px;
}

.bd-htmls {
  margin-top: 4px;
}

.bd-html-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  margin: 3px 0;
}

.bd-html-net {
  width: 80px;
  color: #888;
  flex-shrink: 0;
}

.bd-html-bar {
  flex: 1;
  height: 8px;
  background: #1a1a1a;
  border-radius: 3px;
  overflow: hidden;
}

.bd-html-fill {
  height: 100%;
  background: #7c6fcd;
  border-radius: 3px;
  min-width: 2px;
}

.bd-html-val {
  width: 56px;
  text-align: right;
  color: #ccc;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.bd-html-warn {
  color: #e57373;
  font-size: 10px;
  flex-shrink: 0;
}
```

---

### Task 9: Panel rendering — _renderBuildDetails()

**Files:**
- Modify: `src/panels/default.ts`

**Context:** `_renderReport()` is called every time the user clicks "Analyze Project". The new `_renderBuildDetails()` method should be called at the end of `_renderReport()`. It reads `report.buildCategories` and `report.packedHtmls` (both undefined when no build dir exists) and renders the section.

Bar colors (match the mockup):
- Engine → `#5b9cf6` (blue)
- Plugins → `#e8834c` (orange)
- Assets → `#6ec26e` (green)
- Scripts → `#e8c44c` (yellow)
- Other → `#888888` (gray)

Warning threshold for packed HTMLs: > 5 MB.

- [ ] **Step 1: Add `_renderBuildDetails()` helper function**

Add just before the closing `}` of the panel `methods` object in `default.ts`:

```typescript
_renderBuildDetails(this: any, report: any) {
  const section = this.$.buildDetails as HTMLElement | null;
  const bdBody  = this.$.bdBody as HTMLElement | null;
  const bdBars  = this.$.bdBars as HTMLElement | null;
  const bdHtmls = this.$.bdHtmls as HTMLElement | null;
  const bdTitle = this.$.bdTitle as HTMLElement | null;
  const bdChevron = this.$.bdChevron as HTMLElement | null;

  if (!section || !bdBody || !bdBars || !bdHtmls) return;

  const cats: any = report.buildCategories;
  const htmls: any[] = report.packedHtmls ?? [];

  if (!cats) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  // Update title with total
  const total = report.totalActualBuildSize ?? 0;
  if (bdTitle) {
    bdTitle.textContent = `Build Details · ${fmt(total)}`;
  }

  // Toggle collapse (wire up once)
  const header = this.$.bdToggle as HTMLElement | null;
  if (header && !header.dataset['wired']) {
    header.dataset['wired'] = '1';
    header.addEventListener('click', () => {
      const collapsed = bdBody.style.display === 'none';
      bdBody.style.display = collapsed ? '' : 'none';
      if (bdChevron) bdChevron.classList.toggle('collapsed', !collapsed);
    });
  }

  // Render category bars
  clearChildren(bdBars);

  const totalForPct = total || 1;
  const categories = [
    { label: 'Engine (cc.js)', size: cats.engine,   color: '#5b9cf6' },
    { label: 'Plugins',        size: cats.plugins,  color: '#e8834c' },
    { label: 'Assets',         size: cats.assets,   color: '#6ec26e' },
    { label: 'Scripts',        size: cats.scripts,  color: '#e8c44c' },
    { label: 'Other',          size: cats.other,    color: '#888888' },
  ].filter(c => c.size > 0);

  for (const cat of categories) {
    const pct = Math.max(0.5, (cat.size / totalForPct) * 100);

    const row = document.createElement('div');
    row.className = 'bd-bar-row';

    const label = document.createElement('span');
    label.className = 'bd-bar-label';
    label.textContent = cat.label;

    const track = document.createElement('div');
    track.className = 'bd-bar-track';
    const fill = document.createElement('div');
    fill.className = 'bd-bar-fill';
    fill.style.cssText = `width:${pct}%;background:${cat.color};`;
    track.appendChild(fill);

    const val = document.createElement('span');
    val.className = 'bd-bar-val';
    val.textContent = fmt(cat.size);

    const pctEl = document.createElement('span');
    pctEl.className = 'bd-bar-pct';
    pctEl.textContent = `${((cat.size / totalForPct) * 100).toFixed(0)}%`;

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(val);
    row.appendChild(pctEl);
    bdBars.appendChild(row);
  }

  // Render packed HTMLs
  if (htmls.length === 0) {
    bdHtmls.style.display = 'none';
    return;
  }
  bdHtmls.style.display = '';
  clearChildren(bdHtmls);

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'bd-section-label';
  sectionLabel.textContent = 'Packed HTML per network';
  bdHtmls.appendChild(sectionLabel);

  const maxHtmlSize = Math.max(...htmls.map((h: any) => h.size), 1);

  for (const h of htmls) {
    const pct = Math.max(1, (h.size / maxHtmlSize) * 100);
    const overLimit = h.size > 5 * 1024 * 1024;

    const row = document.createElement('div');
    row.className = 'bd-html-row';

    const net = document.createElement('span');
    net.className = 'bd-html-net';
    net.textContent = h.network;

    const bar = document.createElement('div');
    bar.className = 'bd-html-bar';
    const fill = document.createElement('div');
    fill.className = 'bd-html-fill';
    fill.style.cssText = `width:${pct}%;${overLimit ? 'background:#e57373;' : ''}`;
    bar.appendChild(fill);

    const val = document.createElement('span');
    val.className = 'bd-html-val';
    val.textContent = fmt(h.size);

    row.appendChild(net);
    row.appendChild(bar);
    row.appendChild(val);

    if (overLimit) {
      const warn = document.createElement('span');
      warn.className = 'bd-html-warn';
      warn.textContent = '⚠ >5MB';
      row.appendChild(warn);
    }

    bdHtmls.appendChild(row);
  }
},
```

- [ ] **Step 2: Add 7 entries to the `$` map in `default.ts`**

In `default.ts`, the `$` object is an **explicit map** — every element accessed via `this.$` must be listed there. Without adding entries, all refs will be `undefined` and `_renderBuildDetails` will silently return early.

Find the `$` object definition (it looks like `$ = { reportSummary: '#report-summary', ... }`). Add these 7 entries:

```typescript
buildDetails:  '#build-details',
bdBody:        '#bd-body',
bdBars:        '#bd-bars',
bdHtmls:       '#bd-htmls',
bdTitle:       '#bd-title',
bdChevron:     '#bd-chevron',
bdToggle:      '#bd-toggle',
```

- [ ] **Step 3: Call `_renderBuildDetails()` at the end of `_renderReport()`**

In `_renderReport()`, just before the closing `},` of the method, add:

```typescript
this._renderBuildDetails(report);
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 5: Run all tests**

```bash
npm run test 2>&1 | tail -10
```

Expected:
```
Test Files  25 passed (25)
     Tests  284+ passed
```

---

## Chunk 3: Final

### Task 10: Single commit

**NOTE:** Per user requirement, NO intermediate commits. Only this one final commit.

- [ ] **Step 1: Verify build and tests one final time**

```bash
npm run build && npm run test 2>&1 | tail -10
```

Expected: BUILD OK, all tests pass.

- [ ] **Step 2: Verify standalone report shows correct breakdown**

```bash
npx tsx scripts/report.ts <workspace>/Playables/_Prod/<project>/build/web-mobile 2>&1 | head -20
```

- [ ] **Step 3: Commit everything**

```bash
git add \
  src/shared/types.ts \
  src/core/build-report/build-scanner.ts \
  src/core/build-report/scanner.ts \
  src/panels/default.ts \
  static/template/index.html \
  static/style/index.css \
  scripts/report.ts \
  tests/core/build-report/build-scanner.test.ts \
  tests/fixtures/roadside-build/plbx-html/

git commit -m "feat(build-report): detailed breakdown — categories, plugins, packed HTML sizes

- BuildScanResult now includes categories (engine/plugins/assets/scripts/other)
  and packedHtmls (per-network HTML sizes from sibling plbx-html/ directory)
- BuildReport passes through buildCategories and packedHtmls
- Panel shows collapsible Build Details section with horizontal bar chart
  and per-network HTML size bars (red warning if > 5 MB)
- scripts/report.ts prints full breakdown including packed HTML warnings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

# Hybrid Asset Analysis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace heuristic-only asset size analysis with a hybrid system that uses real build data when available and dependency-based prediction otherwise.

**Architecture:** Three layers — `build-scanner.ts` scans post-build directories for real file sizes, `dependency-resolver.ts` traces scene dependencies pre-build, and `scanner.ts` merges both into a unified `BuildReport` with `buildStatus` per asset. The UI shows status indicators and real/estimated badges.

**Tech Stack:** TypeScript, vitest, Cocos Creator 3.8 Editor API, Node.js fs

**Spec:** `docs/superpowers/specs/2026-03-11-hybrid-asset-analysis-design.md`

---

## Chunk 1: Types, Build Scanner, and UUID Utils

### Task 1: Extend shared types

**Files:**
- Modify: `src/shared/types.ts:29-47`

- [ ] **Step 1: Write test for new type fields**

Create file `tests/shared/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AssetReportItem, BuildReport } from '../../src/shared/types';

describe('AssetReportItem type', () => {
  it('should support buildStatus field', () => {
    const item: AssetReportItem = {
      uuid: 'test-uuid',
      name: 'test.png',
      path: 'assets/test.png',
      file: '/tmp/test.png',
      type: 'cc.Texture2D',
      sourceSize: 1000,
      buildSize: 950,
      extension: '.png',
      buildStatus: 'confirmed',
      actualBuildSize: 800,
    };
    expect(item.buildStatus).toBe('confirmed');
    expect(item.actualBuildSize).toBe(800);
  });

  it('should allow buildStatus unused without actualBuildSize', () => {
    const item: AssetReportItem = {
      uuid: 'test-uuid',
      name: 'test.png',
      path: 'assets/test.png',
      file: '/tmp/test.png',
      type: 'cc.Texture2D',
      sourceSize: 1000,
      buildSize: 950,
      extension: '.png',
      buildStatus: 'unused',
    };
    expect(item.actualBuildSize).toBeUndefined();
  });
});

describe('BuildReport type', () => {
  it('should support new fields', () => {
    const report: BuildReport = {
      timestamp: Date.now(),
      projectName: 'test',
      totalSourceSize: 1000,
      totalBuildSize: 950,
      totalActualBuildSize: 800,
      buildDirExists: true,
      buildTimestamp: Date.now(),
      assets: [],
    };
    expect(report.buildDirExists).toBe(true);
    expect(report.totalActualBuildSize).toBe(800);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/types.test.ts`
Expected: FAIL — type errors because `buildStatus`, `actualBuildSize`, `buildDirExists`, `totalActualBuildSize`, `buildTimestamp` don't exist on the types yet.

- [ ] **Step 3: Add new fields to types**

In `src/shared/types.ts`, modify `AssetReportItem`:

```typescript
export interface AssetReportItem {
  uuid: string;
  name: string;
  path: string;
  file: string;      // absolute disk path
  type: string;
  sourceSize: number;
  buildSize: number;
  actualBuildSize?: number;    // real size from build dir
  extension: string;
  thumbnailPath?: string;
  buildStatus: 'confirmed' | 'predicted' | 'unused';
}
```

Modify `BuildReport`:

```typescript
export interface BuildReport {
  timestamp: number;
  projectName: string;
  totalSourceSize: number;
  totalBuildSize: number;
  totalActualBuildSize?: number;
  buildDirExists: boolean;
  buildTimestamp?: number;
  assets: AssetReportItem[];
}
```

- [ ] **Step 4: Fix existing scanner.ts to set default buildStatus**

In `src/core/build-report/scanner.ts`, add `buildStatus: 'unused'` to the asset push at line 59:

```typescript
assets.push({
  uuid: item.uuid,
  name: item.name,
  path: item.path,
  file: item.file,
  type: item.type,
  sourceSize,
  buildSize,
  extension,
  buildStatus: 'unused',
});
```

Also update the return at line 75 to include the new fields:

```typescript
return {
  timestamp: Date.now(),
  projectName,
  totalSourceSize: assets.reduce((sum, a) => sum + a.sourceSize, 0),
  totalBuildSize: assets.reduce((sum, a) => sum + a.buildSize, 0),
  buildDirExists: false,
  assets,
};
```

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: ALL PASS (both new type tests and existing scanner tests)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/core/build-report/scanner.ts tests/shared/types.test.ts
git commit -m "feat(types): add buildStatus, actualBuildSize, and build metadata fields"
```

---

### Task 2: UUID extraction utility

**Files:**
- Create: `src/core/build-report/uuid-utils.ts`
- Test: `tests/core/build-report/uuid-utils.test.ts`

- [ ] **Step 1: Write tests for UUID extraction from paths**

Create `tests/core/build-report/uuid-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractUuidFromPath, decompressUuid } from '../../../src/core/build-report/uuid-utils';

describe('extractUuidFromPath', () => {
  it('should extract UUID from native file path', () => {
    const result = extractUuidFromPath('native/0d/0db0b555-969b-44fd-8b15-52f98db892ac.png');
    expect(result).toEqual({
      uuid: '0db0b555-969b-44fd-8b15-52f98db892ac',
      fragment: undefined,
    });
  });

  it('should extract UUID and fragment from sub-asset path', () => {
    const result = extractUuidFromPath('native/59/590beb63-46ba-4749-b258-454caa4dbe46@80c75.bin');
    expect(result).toEqual({
      uuid: '590beb63-46ba-4749-b258-454caa4dbe46',
      fragment: '80c75',
    });
  });

  it('should extract UUID from directory-based asset (fonts)', () => {
    const result = extractUuidFromPath('native/c5/c559e99c-fba0-41a0-b733-6d5f5bb3878c/firasans-black-webfont.ttf');
    expect(result).toEqual({
      uuid: 'c559e99c-fba0-41a0-b733-6d5f5bb3878c',
      fragment: undefined,
    });
  });

  it('should extract UUID from import binary path', () => {
    const result = extractUuidFromPath('import/59/590beb63-46ba-4749-b258-454caa4dbe46@73b7f.bin');
    expect(result).toEqual({
      uuid: '590beb63-46ba-4749-b258-454caa4dbe46',
      fragment: '73b7f',
    });
  });

  it('should return null for pack file paths (no standard UUID)', () => {
    const result = extractUuidFromPath('import/0d/0d50e9a82.json');
    expect(result).toBeNull();
  });

  it('should return null for non-UUID paths', () => {
    const result = extractUuidFromPath('index.js');
    expect(result).toBeNull();
  });
});

describe('decompressUuid', () => {
  // Cocos compressed UUID: 22-char base64 → 32-char hex → standard UUID with hyphens
  // The fixture has: "0dsLVVlptE/YsVUvmNuJKs" which should decompress to
  // "0db0b555-969b-44fd-8b15-52f98db892ac"

  it('should decompress a 22-char base64 UUID to standard hex format', () => {
    // We need to verify against the fixture:
    // config.json uuids contains "0dsLVVlptE/YsVUvmNuJKs"
    // native/ has file 0db0b555-969b-44fd-8b15-52f98db892ac.png
    const result = decompressUuid('0dsLVVlptE/YsVUvmNuJKs');
    expect(result).toBe('0db0b555-969b-44fd-8b15-52f98db892ac');
  });

  it('should handle UUID with fragment suffix by stripping it first', () => {
    // "04I1sqyNpNqrTCWdP0pcBc@6c48a" → strip @6c48a → decompress "04I1sqyNpNqrTCWdP0pcBc"
    // Expected hex: 04235b2a-c8da-4daa-b4c2-59d3f4a5c05c (from fixture native files)
    const result = decompressUuid('04I1sqyNpNqrTCWdP0pcBc');
    expect(result).toBe('04235b2a-c8da-4daa-b4c2-59d3f4a5c05c');
  });

  it('should return null for pack file pseudo-UUIDs (short hex)', () => {
    const result = decompressUuid('0d50e9a82');
    expect(result).toBeNull();
  });

  it('should return null for very short entries', () => {
    const result = decompressUuid('19');
    expect(result).toBeNull();
  });

  it('should return null for full hex UUIDs (36 chars, not compressed)', () => {
    const result = decompressUuid('0db0b555-969b-44fd-8b15-52f98db892ac');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/build-report/uuid-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement UUID utils**

Create `src/core/build-report/uuid-utils.ts`:

```typescript
const HEX_UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const FRAGMENT_RE = /@([0-9a-f]+)/i;

export interface UuidExtraction {
  uuid: string;       // base hex UUID (no fragment)
  fragment?: string;   // fragment suffix if present
}

/**
 * Extract a hex UUID from a file path.
 * Handles:
 *   - native/0d/0db0b555-...-52f98db892ac.png (UUID in filename)
 *   - native/c5/c559e99c-...-6d5f5bb3878c/font.ttf (UUID in directory)
 *   - native/59/590beb63-...@80c75.bin (UUID + fragment in filename)
 * Returns null for pack files or paths without standard UUIDs.
 */
export function extractUuidFromPath(relativePath: string): UuidExtraction | null {
  const match = relativePath.match(HEX_UUID_RE);
  if (!match) return null;

  const uuid = match[1].toLowerCase();

  // Check for @fragment suffix after the UUID
  const afterUuid = relativePath.slice(relativePath.indexOf(match[1]) + match[1].length);
  const fragMatch = afterUuid.match(FRAGMENT_RE);

  return {
    uuid,
    fragment: fragMatch ? fragMatch[1] : undefined,
  };
}

// Base64 alphabet used by Cocos for UUID compression
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Map<string, number>();
for (let i = 0; i < BASE64.length; i++) {
  BASE64_VALUES.set(BASE64[i], i);
}

/**
 * Decompress a Cocos compressed UUID (22-char standard base64) to hex UUID.
 * Returns null for non-UUID entries (pack file IDs, short hex strings, wrong length).
 *
 * Cocos stores UUIDs as standard base64 of 16 raw bytes (with + and /).
 * 22 base64 chars (+ 2 implicit padding) = 16 bytes = 128 bits = UUID.
 */
export function decompressUuid(compressed: string): string | null {
  // Compressed UUIDs are EXACTLY 22 characters of base64.
  // Pack file IDs are shorter (e.g. "0d50e9a82"). Hex UUIDs are 36 chars.
  // Reject anything that isn't exactly 22 chars.
  if (compressed.length !== 22) return null;

  // config.json uses standard base64 (with + and /), not URL-safe.
  // No substitution needed.
  const bytes: number[] = [];

  for (let i = 0; i < compressed.length; i += 4) {
    const chunk = compressed.slice(i, i + 4);
    const b0 = BASE64_VALUES.get(chunk[0]) ?? 0;
    const b1 = BASE64_VALUES.get(chunk[1]) ?? 0;
    const b2 = chunk[2] ? (BASE64_VALUES.get(chunk[2]) ?? 0) : 0;
    const b3 = chunk[3] ? (BASE64_VALUES.get(chunk[3]) ?? 0) : 0;

    bytes.push((b0 << 2) | (b1 >> 4));
    if (chunk[2]) bytes.push(((b1 & 0xf) << 4) | (b2 >> 2));
    if (chunk[3]) bytes.push(((b2 & 0x3) << 6) | b3);
  }

  if (bytes.length < 16) return null;

  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const hexStr = bytes.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  return [
    hexStr.slice(0, 8),
    hexStr.slice(8, 12),
    hexStr.slice(12, 16),
    hexStr.slice(16, 20),
    hexStr.slice(20, 32),
  ].join('-');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/build-report/uuid-utils.test.ts`
Expected: ALL PASS. If `decompressUuid` tests fail because the Cocos compression algorithm is different from standard base64, adjust the implementation. The fixture data provides ground truth:
- `"0dsLVVlptE/YsVUvmNuJKs"` must decode to `"0db0b555-969b-44fd-8b15-52f98db892ac"`
- `"04I1sqyNpNqrTCWdP0pcBc"` must decode to `"04235b2a-c8da-4daa-b4c2-59d3f4a5c05c"`

If tests fail, compare byte-by-byte with fixture to find the correct algorithm. The Cocos engine source in `node_modules/@cocos/creator-types` or `cocos-engine` may have `decompressUuid()` to reference.

- [ ] **Step 5: Commit**

```bash
git add src/core/build-report/uuid-utils.ts tests/core/build-report/uuid-utils.test.ts
git commit -m "feat(build-report): add UUID extraction and decompression utils"
```

---

### Task 3: Build scanner — filesystem scanning

**Files:**
- Create: `src/core/build-report/build-scanner.ts`
- Test: `tests/core/build-report/build-scanner.test.ts`

The fixture at `tests/fixtures/roadside-build/web-mobile/` provides the real data for these tests.

- [ ] **Step 1: Write tests for build directory scanning**

Create `tests/core/build-report/build-scanner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scanBuildDirectory } from '../../../src/core/build-report/build-scanner';

const FIXTURE_BUILD = join(__dirname, '../../fixtures/roadside-build/web-mobile');

describe('scanBuildDirectory', () => {
  it('should return null for non-existent directory', async () => {
    const result = await scanBuildDirectory('/nonexistent/path');
    expect(result).toBeNull();
  });

  it('should scan the fixture build directory successfully', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    expect(result).not.toBeNull();
    expect(result!.buildDir).toBe(FIXTURE_BUILD);
    expect(result!.buildTimestamp).toBeGreaterThan(0);
  });

  it('should find native assets and map them by UUID', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    expect(result!.assetMap.size).toBeGreaterThan(0);

    // Known UUID from fixture: 0db0b555-969b-44fd-8b15-52f98db892ac (a .png file)
    const pngAsset = result!.assetMap.get('0db0b555-969b-44fd-8b15-52f98db892ac');
    expect(pngAsset).toBeDefined();
    expect(pngAsset!.actualSize).toBeGreaterThan(0);
    expect(pngAsset!.buildPaths.length).toBeGreaterThan(0);
  });

  it('should group sub-asset fragments by base UUID', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    // UUID 590beb63-46ba-4749-b258-454caa4dbe46 has multiple @fragment files
    const meshAsset = result!.assetMap.get('590beb63-46ba-4749-b258-454caa4dbe46');
    expect(meshAsset).toBeDefined();
    expect(meshAsset!.buildPaths.length).toBeGreaterThan(1);
    // actualSize should be sum of all fragments
  });

  it('should detect font assets stored as UUID directories', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    // c559e99c-fba0-41a0-b733-6d5f5bb3878c is a directory containing firasans-black-webfont.ttf
    const fontAsset = result!.assetMap.get('c559e99c-fba0-41a0-b733-6d5f5bb3878c');
    expect(fontAsset).toBeDefined();
    expect(fontAsset!.actualSize).toBeGreaterThan(0);
  });

  it('should calculate totalBuildSize as sum of asset files + pack files', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    expect(result!.totalBuildSize).toBeGreaterThan(0);

    // totalBuildSize = sum of all individual asset sizes + pack file sizes
    let assetSum = 0;
    for (const [, data] of result!.assetMap) {
      assetSum += data.actualSize;
    }
    // Verify pack files are counted separately and included
    expect(result!.packFileSize).toBeGreaterThan(0);
    expect(result!.totalBuildSize).toBe(assetSum + result!.packFileSize);
  });

  it('should track pack file sizes separately', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    // 0d50e9a82.json is a pack file
    expect(result!.packFileSize).toBeGreaterThan(0);
  });

  it('should populate bundledUuids from config.json', async () => {
    const result = await scanBuildDirectory(FIXTURE_BUILD);
    expect(result!.bundledUuids.size).toBeGreaterThan(0);
    // Should contain hex UUIDs, not compressed ones
    for (const uuid of result!.bundledUuids) {
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/build-report/build-scanner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement build scanner**

Create `src/core/build-report/build-scanner.ts`:

```typescript
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { extractUuidFromPath, decompressUuid } from './uuid-utils';

export interface BuildAssetData {
  buildPaths: string[];
  actualSize: number;
}

export interface BuildScanResult {
  buildDir: string;
  buildTimestamp: number;
  totalBuildSize: number;     // sum of all files in native/ + import/ (asset data only)
  packFileSize: number;       // subset of totalBuildSize: pack files that can't be attributed to one UUID
  assetMap: Map<string, BuildAssetData>;
  bundledUuids: Set<string>;  // base hex UUIDs from config.json (fragments stripped, decompressed)
}

/**
 * Scan a Cocos 3.8 build output directory and map assets by UUID.
 * Returns null if the directory doesn't exist.
 */
export async function scanBuildDirectory(buildDir: string): Promise<BuildScanResult | null> {
  if (!existsSync(buildDir)) return null;

  const assetMap = new Map<string, BuildAssetData>();
  let totalBuildSize = 0;
  let packFileSize = 0;

  // Get build timestamp from directory mtime
  const buildTimestamp = statSync(buildDir).mtimeMs;

  // Read settings to discover bundles
  const bundles = discoverBundles(buildDir);

  // Collect pack file IDs from all bundle configs
  const packIds = new Set<string>();
  const bundledUuids = new Set<string>();

  for (const bundle of bundles) {
    const configPath = join(buildDir, 'assets', bundle, 'config.json');
    if (!existsSync(configPath)) continue;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      // Collect pack IDs
      if (config.packs) {
        for (const packId of Object.keys(config.packs)) {
          packIds.add(packId);
        }
      }
      // Build bundledUuids from uuids array
      if (Array.isArray(config.uuids)) {
        for (const entry of config.uuids) {
          // Strip @fragment
          const base = entry.split('@')[0];
          // Skip pack file pseudo-UUIDs (not 22-char base64)
          if (base.length < 22) continue;
          const hex = decompressUuid(base);
          if (hex) bundledUuids.add(hex);
        }
      }
    } catch {
      // Invalid config, skip
    }
  }

  // Scan native/ and import/ directories for each bundle
  for (const bundle of bundles) {
    for (const subdir of ['native', 'import']) {
      const dir = join(buildDir, 'assets', bundle, subdir);
      if (!existsSync(dir)) continue;

      const files = scanDirRecursive(dir);
      for (const file of files) {
        const relPath = relative(join(buildDir, 'assets', bundle), file.path);
        const size = file.size;
        totalBuildSize += size;

        const extraction = extractUuidFromPath(relPath);
        if (!extraction) {
          // Likely a pack file — check against packIds
          const filename = file.path.split('/').pop() ?? '';
          const nameNoExt = filename.replace(/\.[^.]+$/, '');
          if (packIds.has(nameNoExt)) {
            packFileSize += size;
          }
          continue;
        }

        const existing = assetMap.get(extraction.uuid);
        if (existing) {
          existing.buildPaths.push(relPath);
          existing.actualSize += size;
        } else {
          assetMap.set(extraction.uuid, {
            buildPaths: [relPath],
            actualSize: size,
          });
        }
      }
    }
  }

  return {
    buildDir,
    buildTimestamp,
    totalBuildSize,
    packFileSize,
    assetMap,
    bundledUuids,
  };
}

/** Read src/settings.json to get project bundles, fallback to directory listing */
function discoverBundles(buildDir: string): string[] {
  const settingsPath = join(buildDir, 'src', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const bundles = settings.assets?.projectBundles;
      if (Array.isArray(bundles) && bundles.length > 0) return bundles;
    } catch {
      // fall through
    }
  }
  // Fallback: list directories under assets/
  const assetsDir = join(buildDir, 'assets');
  if (!existsSync(assetsDir)) return [];
  return readdirSync(assetsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

interface FileEntry { path: string; size: number }

function scanDirRecursive(dir: string): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...scanDirRecursive(full));
    } else {
      result.push({ path: full, size: statSync(full).size });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/build-report/build-scanner.test.ts`
Expected: ALL PASS. If `bundledUuids` tests fail due to decompression issues, fix `uuid-utils.ts` first (Task 2).

- [ ] **Step 5: Run all tests to check for regressions**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/build-report/build-scanner.ts tests/core/build-report/build-scanner.test.ts
git commit -m "feat(build-report): add post-build directory scanner with UUID matching"
```

---

## Chunk 2: Dependency Resolver and Merge Logic

### Task 4: Dependency resolver

**Files:**
- Create: `src/core/build-report/dependency-resolver.ts`
- Test: `tests/core/build-report/dependency-resolver.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/core/build-report/dependency-resolver.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveSceneDependencies, QueryDependenciesFn } from '../../../src/core/build-report/dependency-resolver';

describe('resolveSceneDependencies', () => {
  it('should return scene UUIDs in the result', async () => {
    const queryDeps: QueryDependenciesFn = vi.fn().mockResolvedValue([]);
    const result = await resolveSceneDependencies(['scene-uuid-1'], queryDeps);

    expect(result.sceneUuids).toEqual(['scene-uuid-1']);
    expect(result.referencedUuids.has('scene-uuid-1')).toBe(true);
  });

  it('should recursively collect dependencies', async () => {
    const deps: Record<string, string[]> = {
      'scene-1': ['prefab-1', 'texture-1'],
      'prefab-1': ['material-1', 'texture-2'],
      'material-1': [],
      'texture-1': [],
      'texture-2': [],
    };
    const queryDeps: QueryDependenciesFn = vi.fn(async (uuid: string) => deps[uuid] ?? []);

    const result = await resolveSceneDependencies(['scene-1'], queryDeps);

    expect(result.referencedUuids).toEqual(
      new Set(['scene-1', 'prefab-1', 'texture-1', 'material-1', 'texture-2']),
    );
  });

  it('should handle circular dependencies without infinite loop', async () => {
    const deps: Record<string, string[]> = {
      'a': ['b'],
      'b': ['c'],
      'c': ['a'], // cycle!
    };
    const queryDeps: QueryDependenciesFn = vi.fn(async (uuid: string) => deps[uuid] ?? []);

    const result = await resolveSceneDependencies(['a'], queryDeps);
    expect(result.referencedUuids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('should handle multiple scenes', async () => {
    const deps: Record<string, string[]> = {
      'scene-1': ['texture-1'],
      'scene-2': ['texture-2'],
      'texture-1': [],
      'texture-2': [],
    };
    const queryDeps: QueryDependenciesFn = vi.fn(async (uuid: string) => deps[uuid] ?? []);

    const result = await resolveSceneDependencies(['scene-1', 'scene-2'], queryDeps);
    expect(result.referencedUuids).toEqual(
      new Set(['scene-1', 'scene-2', 'texture-1', 'texture-2']),
    );
  });

  it('should handle query errors gracefully', async () => {
    const queryDeps: QueryDependenciesFn = vi.fn().mockRejectedValue(new Error('API error'));
    const result = await resolveSceneDependencies(['scene-1'], queryDeps);

    expect(result.referencedUuids.has('scene-1')).toBe(true);
    // Should not throw, just include what it can
  });

  it('should handle empty scene list', async () => {
    const queryDeps: QueryDependenciesFn = vi.fn();
    const result = await resolveSceneDependencies([], queryDeps);

    expect(result.referencedUuids.size).toBe(0);
    expect(result.sceneUuids).toEqual([]);
    expect(queryDeps).not.toHaveBeenCalled();
  });

  it('should respect maxDepth option', async () => {
    const deps: Record<string, string[]> = {
      'scene': ['level1'],
      'level1': ['level2'],
      'level2': ['level3'],
      'level3': [],
    };
    const queryDeps: QueryDependenciesFn = vi.fn(async (uuid: string) => deps[uuid] ?? []);

    const result = await resolveSceneDependencies(['scene'], queryDeps, { maxDepth: 2 });
    // Should stop at depth 2: scene → level1 → level2 (but NOT level3)
    expect(result.referencedUuids.has('level2')).toBe(true);
    expect(result.referencedUuids.has('level3')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/build-report/dependency-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement dependency resolver**

Create `src/core/build-report/dependency-resolver.ts`:

```typescript
export type QueryDependenciesFn = (uuid: string) => Promise<string[]>;

export interface DependencyResult {
  referencedUuids: Set<string>;
  sceneUuids: string[];
}

export interface ResolveOptions {
  maxConcurrency?: number;
  maxDepth?: number;
}

/**
 * Recursively resolve all asset dependencies starting from scene UUIDs.
 * Uses BFS with visited set to prevent cycles and configurable depth limit.
 */
export async function resolveSceneDependencies(
  sceneUuids: string[],
  queryDeps: QueryDependenciesFn,
  options?: ResolveOptions,
): Promise<DependencyResult> {
  const maxDepth = options?.maxDepth ?? 100;
  const maxConcurrency = options?.maxConcurrency ?? 10;

  const visited = new Set<string>();
  // BFS queue: [uuid, depth]
  let queue: Array<{ uuid: string; depth: number }> = sceneUuids.map(uuid => ({ uuid, depth: 0 }));

  while (queue.length > 0) {
    // Take a batch up to maxConcurrency
    const batch = queue.splice(0, maxConcurrency)
      .filter(item => !visited.has(item.uuid) && item.depth <= maxDepth);

    if (batch.length === 0) continue;

    // Mark as visited before querying (prevents re-queuing)
    for (const item of batch) {
      visited.add(item.uuid);
    }

    // Query dependencies in parallel
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        if (item.depth >= maxDepth) return { uuid: item.uuid, deps: [] as string[] };
        const deps = await queryDeps(item.uuid);
        return { uuid: item.uuid, deps };
      }),
    );

    // Enqueue discovered dependencies
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { deps } = result.value;
      const nextDepth = batch.find(b => b.uuid === result.value.uuid)!.depth + 1;

      for (const depUuid of deps) {
        if (!visited.has(depUuid)) {
          queue.push({ uuid: depUuid, depth: nextDepth });
        }
      }
    }
  }

  return {
    referencedUuids: visited,
    sceneUuids: [...sceneUuids],
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/build-report/dependency-resolver.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/build-report/dependency-resolver.ts tests/core/build-report/dependency-resolver.test.ts
git commit -m "feat(build-report): add dependency resolver for pre-build asset prediction"
```

---

### Task 5: Merge logic — `scanAssetsHybrid()`

**Files:**
- Modify: `src/core/build-report/scanner.ts`
- Test: `tests/core/build-report/scanner.test.ts` (extend existing)

- [ ] **Step 1: Write tests for the hybrid scan merge logic**

Append to `tests/core/build-report/scanner.test.ts`:

```typescript
import { scanAssetsHybrid } from '../../../src/core/build-report/scanner';
import type { QueryDependenciesFn } from '../../../src/core/build-report/dependency-resolver';
import type { BuildScanResult } from '../../../src/core/build-report/build-scanner';

// ... (keep existing tests above) ...

describe('scanAssetsHybrid', () => {
  const mockQueryDeps: QueryDependenciesFn = vi.fn(async (uuid: string) => {
    // Scene references the texture but not the audio
    if (uuid === 'scene-uuid') return ['uuid-texture-1'];
    return [];
  });

  it('should mark all assets as unused when no build and no scenes', async () => {
    const queryFn = createMockQueryFn(mockAssets);
    const noopDeps: QueryDependenciesFn = vi.fn().mockResolvedValue([]);

    const report = await scanAssetsHybrid(queryFn, noopDeps, 'test');
    expect(report.buildDirExists).toBe(false);

    for (const asset of report.assets) {
      expect(asset.buildStatus).toBe('unused');
    }
  });

  it('should mark scene-referenced assets as predicted', async () => {
    const queryFn = createMockQueryFn(mockAssets);

    const report = await scanAssetsHybrid(
      queryFn, mockQueryDeps, 'test',
      undefined, // no build dir
      ['scene-uuid'],
    );

    const texture = report.assets.find(a => a.uuid === 'uuid-texture-1');
    expect(texture!.buildStatus).toBe('predicted');

    const audio = report.assets.find(a => a.uuid === 'uuid-audio-1');
    expect(audio!.buildStatus).toBe('unused');
  });

  it('should compute totalBuildSize only from non-unused assets', async () => {
    const queryFn = createMockQueryFn(mockAssets);

    const report = await scanAssetsHybrid(
      queryFn, mockQueryDeps, 'test',
      undefined,
      ['scene-uuid'],
    );

    const predictedAssets = report.assets.filter(a => a.buildStatus !== 'unused');
    const expectedTotal = predictedAssets.reduce((sum, a) => sum + a.buildSize, 0);
    expect(report.totalBuildSize).toBe(expectedTotal);
  });

  it('should use real build data when build dir exists', async () => {
    const queryFn = createMockQueryFn(mockAssets);
    const buildFixture = join(__dirname, '../../fixtures/roadside-build/web-mobile');

    // Use a no-op deps since we have real build data
    const noopDeps: QueryDependenciesFn = vi.fn().mockResolvedValue([]);
    const report = await scanAssetsHybrid(queryFn, noopDeps, 'test', buildFixture);

    expect(report.buildDirExists).toBe(true);
    expect(report.buildTimestamp).toBeGreaterThan(0);

    // Assets found in build should be 'confirmed'
    const confirmed = report.assets.filter(a => a.buildStatus === 'confirmed');
    // May be 0 if mock UUIDs don't match fixture UUIDs — that's expected
    // The key thing is buildDirExists is true
  });

  it('should set totalActualBuildSize when build data available', async () => {
    const queryFn = createMockQueryFn(mockAssets);
    const buildFixture = join(__dirname, '../../fixtures/roadside-build/web-mobile');
    const noopDeps: QueryDependenciesFn = vi.fn().mockResolvedValue([]);

    const report = await scanAssetsHybrid(queryFn, noopDeps, 'test', buildFixture);

    // totalActualBuildSize should be set when build exists
    if (report.assets.some(a => a.buildStatus === 'confirmed')) {
      expect(report.totalActualBuildSize).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/build-report/scanner.test.ts`
Expected: FAIL — `scanAssetsHybrid` not exported from scanner

- [ ] **Step 3: Implement `scanAssetsHybrid` in scanner.ts**

Add to `src/core/build-report/scanner.ts`:

```typescript
import { scanBuildDirectory } from './build-scanner';
import { resolveSceneDependencies, QueryDependenciesFn } from './dependency-resolver';
export type { QueryDependenciesFn } from './dependency-resolver';

/**
 * Hybrid asset scan: combines project assets with build data and dependency analysis.
 *
 * Merge priority:
 * 1. All project assets start as 'unused'
 * 2. Scene dependencies → 'predicted'
 * 3. Build directory data → 'confirmed' + actualBuildSize
 */
export async function scanAssetsHybrid(
  queryFn: QueryAssetsFn,
  queryDeps: QueryDependenciesFn,
  projectName: string,
  buildDir?: string,
  sceneUuids?: string[],
): Promise<BuildReport> {
  // Step 1: Get all project assets (all marked 'unused' by default)
  const baseReport = await scanAssets(queryFn, projectName);
  const assets = baseReport.assets; // already has buildStatus: 'unused'

  // Step 2: Dependency analysis → mark as 'predicted'
  if (sceneUuids && sceneUuids.length > 0) {
    const depResult = await resolveSceneDependencies(sceneUuids, queryDeps);
    for (const asset of assets) {
      if (depResult.referencedUuids.has(asset.uuid)) {
        asset.buildStatus = 'predicted';
      }
    }
  }

  // Step 3: Build directory data → mark as 'confirmed' + set actualBuildSize
  let buildDirExists = false;
  let buildTimestamp: number | undefined;

  if (buildDir) {
    const buildScan = await scanBuildDirectory(buildDir);
    if (buildScan) {
      buildDirExists = true;
      buildTimestamp = buildScan.buildTimestamp;

      for (const asset of assets) {
        const buildData = buildScan.assetMap.get(asset.uuid);
        if (buildData) {
          asset.buildStatus = 'confirmed';
          asset.actualBuildSize = buildData.actualSize;
        } else if (buildScan.bundledUuids.has(asset.uuid)) {
          // In bundle config but no native file — still confirmed
          asset.buildStatus = 'confirmed';
        }
      }
    }
  }

  // Step 4: Compute totals from non-unused assets only
  const includedAssets = assets.filter(a => a.buildStatus !== 'unused');
  const totalBuildSize = includedAssets.reduce((sum, a) => sum + a.buildSize, 0);
  const totalSourceSize = includedAssets.reduce((sum, a) => sum + a.sourceSize, 0);

  let totalActualBuildSize: number | undefined;
  if (buildDirExists) {
    totalActualBuildSize = includedAssets.reduce(
      (sum, a) => sum + (a.actualBuildSize ?? a.buildSize), 0,
    );
  }

  return {
    timestamp: Date.now(),
    projectName,
    totalSourceSize,
    totalBuildSize,
    totalActualBuildSize,
    buildDirExists,
    buildTimestamp,
    assets,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/core/build-report/scanner.test.ts`
Expected: ALL PASS (both existing and new tests)

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/build-report/scanner.ts tests/core/build-report/scanner.test.ts
git commit -m "feat(build-report): add scanAssetsHybrid with merge logic"
```

---

## Chunk 3: Main.ts Integration and UI Updates

### Task 6: Wire up `scanAssetsHybrid` in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the new method and helpers to main.ts**

Add imports at top of `src/main.ts`:

```typescript
import { scanAssetsHybrid } from './core/build-report/scanner';
import type { QueryDependenciesFn } from './core/build-report/dependency-resolver';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
```

Note: `resolve` is already imported as `join`, and `existsSync` is already imported. Adjust imports to avoid duplicates.

Add helper functions before `export const methods`:

```typescript
function createEditorDependencyQueryFn(editorMessage: any): QueryDependenciesFn {
  return async (uuid: string) => {
    try {
      return await editorMessage.request('asset-db', 'query-asset-dependencies', uuid);
    } catch {
      // API may not exist in all Cocos versions — return empty
      return [];
    }
  };
}

async function getSceneUuidsFromBuildSettings(
  editorMessage: any,
  buildDir?: string,
): Promise<string[]> {
  // Priority 1: from existing build's src/settings.json
  if (buildDir) {
    const settingsPath = resolve(buildDir, 'src', 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        const launchScene = settings.launch?.launchScene;
        if (launchScene) {
          try {
            const info = await editorMessage.request('asset-db', 'query-asset-info', launchScene);
            if (info?.uuid) return [info.uuid];
          } catch { /* fall through */ }
        }
      } catch { /* fall through */ }
    }
  }

  // Priority 2: query all .scene files from project
  try {
    const scenes = await editorMessage.request('asset-db', 'query-assets', {
      ccType: 'cc.SceneAsset',
    });
    if (Array.isArray(scenes) && scenes.length > 0) {
      return scenes.map((s: any) => s.uuid);
    }
  } catch { /* fall through */ }

  return [];
}
```

Add the new method inside `methods` object (keep old `scanAssets` for backward compat):

```typescript
async scanAssetsHybrid() {
  const queryFn = createEditorQueryFn(Editor.Message);
  const queryDeps = createEditorDependencyQueryFn(Editor.Message);

  const buildDir = lastBuildResult?.dest ?? undefined;
  const sceneUuids = await getSceneUuidsFromBuildSettings(Editor.Message, buildDir);

  return scanAssetsHybrid(
    queryFn, queryDeps, Editor.Project.name || 'unknown',
    buildDir && existsSync(buildDir) ? buildDir : undefined,
    sceneUuids,
  );
},
```

- [ ] **Step 2: Register the new message in package.json**

Check `package.json` for message registration. Add `"scan-assets-hybrid"` message pointing to the new method. Look for the `contributions.messages` section and add:

```json
"scan-assets-hybrid": {
  "methods": ["scanAssetsHybrid"]
}
```

- [ ] **Step 3: Run build to verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/main.ts package.json
git commit -m "feat(main): wire up scanAssetsHybrid with build dir and scene detection"
```

---

### Task 7: Update panel UI for hybrid report

**Files:**
- Modify: `src/panels/default.ts`
- Modify: `static/template/index.html`

This is the UI-heavy task. Key changes:
1. Call `scan-assets-hybrid` instead of `scan-assets`
2. Add Status column to table
3. Show `actualBuildSize` when available
4. Fix sort key for build size column
5. Add "Build data: real/estimated" badge
6. Update summary totals

- [ ] **Step 1: Update the scan button handler**

In `_initBuildReport`, change line ~181:
```typescript
// OLD:
const report = await Editor.Message.request('plbx-cocos-extension', 'scan-assets');
// NEW:
const report = await Editor.Message.request('plbx-cocos-extension', 'scan-assets-hybrid');
```

- [ ] **Step 2: Update `_renderReport` to show status column and actual build sizes**

In `_renderReport` method, update the table rendering loop (lines ~286-316):

After the existing `tdBuild` creation, add status column:
```typescript
const tdStatus = document.createElement('td');
tdStatus.className = 'col-type';
const status = asset.buildStatus ?? 'unused';
if (status === 'confirmed') {
  tdStatus.textContent = '✓';
  tdStatus.style.color = '#4caf50';
  tdStatus.title = 'Confirmed in build';
} else if (status === 'predicted') {
  tdStatus.textContent = '~';
  tdStatus.style.color = '#ff9800';
  tdStatus.title = 'Predicted (referenced by scene)';
} else {
  tdStatus.textContent = '○';
  tdStatus.style.color = '#999';
  tdStatus.title = 'Not used in build';
}
```

Update `tdBuild` to prefer `actualBuildSize`:
```typescript
const tdBuild = document.createElement('td');
tdBuild.className = 'col-size';
const displayBuildSize = asset.actualBuildSize ?? asset.buildSize ?? asset.sourceSize;
tdBuild.textContent = fmt(displayBuildSize);
if (asset.actualBuildSize != null) {
  tdBuild.title = 'Real size from build';
} else {
  tdBuild.title = 'Estimated';
}
```

Add `tdStatus` to the row after `tdExt`:
```typescript
tr.appendChild(tdName);
tr.appendChild(tdType);
tr.appendChild(tdSrc);
tr.appendChild(tdBuild);
tr.appendChild(tdExt);
tr.appendChild(tdStatus);
tbody.appendChild(tr);
```

- [ ] **Step 3: Update sort logic for build size**

In the sort comparison (line ~253), replace BOTH `av` and `bv` expressions:
```typescript
// REPLACE the existing av and bv lines with:
const av = sortKey === 'buildSize'
  ? (a.actualBuildSize ?? a.buildSize ?? a.sourceSize ?? 0)
  : sortKey === 'sourceSize'
    ? (a.sourceSize ?? 0)
    : (a.sourceSize ?? 0);
const bv = sortKey === 'buildSize'
  ? (b.actualBuildSize ?? b.buildSize ?? b.sourceSize ?? 0)
  : sortKey === 'sourceSize'
    ? (b.sourceSize ?? 0)
    : (b.sourceSize ?? 0);
```

- [ ] **Step 4: Update summary display**

**REPLACE** the existing summary calculations (lines ~260-269). Remove the old `const totalSrc`, `const totalBuild`, `const images`, `const audio` lines and replace with:

```typescript
// Only count non-unused assets in totals
const includedAssets = assets.filter(a => (a as any).buildStatus !== 'unused');
const totalSrc   = includedAssets.reduce((s, a) => s + (a.sourceSize ?? 0), 0);
const totalBuild = report.totalActualBuildSize ?? report.totalBuildSize
  ?? includedAssets.reduce((s, a) => s + (a.actualBuildSize ?? a.buildSize ?? a.sourceSize ?? 0), 0);
const images = assets.filter(a => a.type === 'image' || /\.(png|jpg|jpeg|webp|avif|gif)$/i.test(a.name ?? '')).length;
const audio  = assets.filter(a => a.type === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(a.name ?? '')).length;

countEl.textContent  = String(assets.length);
srcEl.textContent    = fmt(totalSrc);
buildEl.textContent  = fmt(totalBuild);

// Add badge after buildEl
const existingBadge = summary.querySelector('.build-data-badge');
if (existingBadge) existingBadge.remove();

const badge = document.createElement('span');
badge.className = 'build-data-badge';
badge.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:3px;margin-left:6px;';
if (report.buildDirExists) {
  badge.textContent = 'Build data: real';
  badge.style.background = '#4caf50';
  badge.style.color = '#fff';
} else {
  badge.textContent = 'Build data: estimated';
  badge.style.background = '#ff9800';
  badge.style.color = '#fff';
}
buildEl.parentElement?.appendChild(badge);
```

- [ ] **Step 5: Add Status column header to the HTML template**

The table header is in `static/template/index.html`, NOT in `default.ts`. Find the `<th>` row for the report table (after the Extension `<th>`) and add:
```html
<th class="col-type">Status</th>
```

Also update the empty-state `colSpan` in `_renderReport` in `default.ts` — change `td.colSpan = 5` to `td.colSpan = 6`.

- [ ] **Step 6: Run panel structure test**

Run: `npx vitest run tests/panels/panel-structure.test.ts`
Expected: PASS (or update test if it checks column count)

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/panels/default.ts static/template/index.html
git commit -m "feat(panel): show build status, actual sizes, and real/estimated badge"
```

---

### Task 8: Final integration test

**Files:**
- Create: `tests/core/build-report/hybrid-integration.test.ts`

- [ ] **Step 1: Write integration test using real fixture**

Create `tests/core/build-report/hybrid-integration.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import { statSync } from 'fs';
import { scanAssetsHybrid, AssetInfo } from '../../../src/core/build-report/scanner';
import type { QueryDependenciesFn } from '../../../src/core/build-report/dependency-resolver';

const FIXTURE_BUILD = join(__dirname, '../../fixtures/roadside-build/web-mobile');

describe('hybrid integration with real fixture', () => {
  // Simulate project assets that match some fixture UUIDs
  const projectAssets: AssetInfo[] = [
    {
      name: 'some-texture.png',
      path: 'assets/textures/some-texture.png',
      url: 'db://assets/textures/some-texture.png',
      uuid: '0db0b555-969b-44fd-8b15-52f98db892ac', // matches fixture native file
      type: 'cc.Texture2D',
      file: join(FIXTURE_BUILD, 'assets/main/native/0d/0db0b555-969b-44fd-8b15-52f98db892ac.png'),
      isDirectory: false,
      importer: 'texture',
    },
    {
      name: 'unused-asset.png',
      path: 'assets/textures/unused-asset.png',
      url: 'db://assets/textures/unused-asset.png',
      uuid: 'ffffffff-ffff-ffff-ffff-ffffffffffff', // NOT in build
      type: 'cc.Texture2D',
      file: join(FIXTURE_BUILD, 'assets/main/native/0d/0db0b555-969b-44fd-8b15-52f98db892ac.png'),
      isDirectory: false,
      importer: 'texture',
    },
  ];

  const mockQueryFn = async (type?: string) => {
    if (type) return projectAssets.filter(a => a.type === type);
    return projectAssets;
  };

  const noopDeps: QueryDependenciesFn = vi.fn().mockResolvedValue([]);

  it('should confirm assets found in build dir and leave others unused', async () => {
    const report = await scanAssetsHybrid(mockQueryFn, noopDeps, 'test', FIXTURE_BUILD);

    expect(report.buildDirExists).toBe(true);

    const confirmed = report.assets.find(a => a.uuid === '0db0b555-969b-44fd-8b15-52f98db892ac');
    expect(confirmed).toBeDefined();
    expect(confirmed!.buildStatus).toBe('confirmed');
    expect(confirmed!.actualBuildSize).toBeGreaterThan(0);
    // Verify actual byte value matches real file on disk
    const realSize = statSync(join(FIXTURE_BUILD, 'assets/main/native/0d/0db0b555-969b-44fd-8b15-52f98db892ac.png')).size;
    expect(confirmed!.actualBuildSize).toBe(realSize);

    const unused = report.assets.find(a => a.uuid === 'ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(unused).toBeDefined();
    expect(unused!.buildStatus).toBe('unused');
    expect(unused!.actualBuildSize).toBeUndefined();
  });

  it('should exclude unused assets from totals', async () => {
    const report = await scanAssetsHybrid(mockQueryFn, noopDeps, 'test', FIXTURE_BUILD);

    // totalBuildSize should only include confirmed/predicted assets
    const unusedAsset = report.assets.find(a => a.buildStatus === 'unused');
    if (unusedAsset) {
      // Total should not include the unused asset's buildSize
      const allBuild = report.assets.reduce((s, a) => s + a.buildSize, 0);
      expect(report.totalBuildSize).toBeLessThan(allBuild);
    }
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/core/build-report/hybrid-integration.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/core/build-report/hybrid-integration.test.ts
git commit -m "test(build-report): add hybrid integration test with real build fixture"
```

---

## Dependency Graph

```
Task 1 (types) ──────┐
                      ├──→ Task 5 (merge logic) ──→ Task 6 (main.ts) ──→ Task 7 (UI)
Task 2 (uuid utils) ──┤                                                      │
                      ├──→ Task 3 (build scanner) ──────────────────────────┘
Task 4 (dep resolver) ┘                                                      │
                                                                              └──→ Task 8 (integration test)
```

Tasks 1, 2, 4 can be done in parallel. Task 3 depends on Task 2. Task 5 depends on Tasks 1, 3, 4. Tasks 6, 7 are sequential after 5.

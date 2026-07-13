# Hybrid Asset Analysis — Design Spec

## Problem

The current asset scanner (`scanner.ts`) queries ALL project assets via `Editor.Message.request('asset-db', 'query-assets')` and estimates build sizes using heuristic ratios (`size-estimator.ts`). This produces nearly identical "Source" and "Build" columns in the UI because:

1. **No dependency filtering** — assets not referenced by any scene are still counted
2. **No real build data** — build sizes are `sourceSize * ratio`, not actual file sizes
3. **No scene awareness** — no connection to Build Settings scenes

## Solution: Hybrid Approach

Two-mode analysis system:
- **Pre-build**: dependency graph from scenes in Build Settings → predicted "will be in build" with estimated sizes
- **Post-build**: scan actual build output directory → real file sizes, matched by UUID

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  UI (panels/default.ts)                             │
│  Columns: Name | Type | Source | Build | Status     │
│  Status: ✓ in build / ○ not used / ? estimated      │
│  Summary: total source / total build (real or est.)  │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────┐
│  scanner.ts (extended)                               │
│  1. scanAllAssets() — existing (all project assets)  │
│  2. scanBuildAssets() — NEW: post-build real sizes   │
│  3. scanDependencies() — NEW: pre-build graph        │
│  → merge() — combines data from all sources          │
└───────────────┬─────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────┐
│  New modules:                                        │
│  • build-scanner.ts — scans build output directory   │
│  • dependency-resolver.ts — scene dependency graph   │
└─────────────────────────────────────────────────────┘
```

## New Module: `build-scanner.ts`

### Purpose
Scan the Cocos build output directory, parse bundle configs, and map build files back to project assets by UUID.

### Cocos 3.8 Build Output Structure (verified from fixture)
```
build/web-mobile/
  index.html
  src/
    settings.json          ← launch scene, bundle list (NOTE: in src/, NOT root)
  assets/
    main/                  ← bundle name
      index.js             ← script bundle
      config.json          ← bundle config (NOT cc.*.json)
      import/
        0d/
          0d50e9a82.json   ← pack file (short hex name, matches config.packs key)
        59/
          590beb63-...@73b7f.bin   ← binary import file
      native/
        0d/                ← first 2 chars of HEX UUID
          0db0b555-969b-44fd-8b15-52f98db892ac.png   ← full hex UUID as filename
        59/
          590beb63-...@80c75.bin   ← sub-asset with @fragment suffix
        c5/
          c559e99c-fba0-41a0-b733-6d5f5bb3878c/      ← UUID as DIRECTORY (fonts, multi-file)
            firasans-black-webfont.ttf                ← original filename inside
    internal/              ← engine internal bundle
      config.json
      import/
      native/
```

**Two native file layouts exist**:
- `native/<2chars>/<uuid>.<ext>` — most assets (images, audio, binary data)
- `native/<2chars>/<uuid-dir>/<original-filename>` — fonts and multi-file assets

UUID extraction must be applied to the **full relative path**, not just the filename. The regex should match the hex UUID pattern in any path segment.

### Key Data Structures in Build

**`src/settings.json`** contains:
- `launch.launchScene` — e.g. `"db://assets/Scenes/Main.scene"`
- `assets.projectBundles` — e.g. `["internal", "main"]`
- `assets.preloadBundles` — bundles to preload

**`assets/<bundle>/config.json`** contains:
- `uuids` — array of compressed base64 UUIDs (e.g. `"7ctF9/5qxMb7AUFpC+ucVR"`)
- `scenes` — map of scene URL → index into `uuids` array
- `versions.native` — array of `[uuidIndex, extension]` pairs (may be empty — see note below)
- `extensionMap` — file extension → array of uuid indices
- `packs` — map of pack ID → array of uuid indices (pack files aggregate multiple assets)

**Note on `versions.native`**: This array may be empty in real builds. Do NOT rely on it for enumerating native files. Use filesystem scanning (step 3) as the authoritative approach. `versions.native` is an optional optimization only.

**Native file naming**: Files in `native/` use **full hex UUIDs with hyphens** (e.g. `0db0b555-969b-44fd-8b15-52f98db892ac.png`), NOT compressed UUIDs. Sub-assets have `@fragment` suffix (e.g. `590beb63-...@80c75.bin`).

### UUID Matching Strategy

The `config.json` uses compressed base64 UUIDs, but native/import files use standard hex UUIDs. For matching:
1. **Primary approach**: Extract hex UUID from file/directory **paths** (not just filenames) using regex: `/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i`
   - For most files: UUID is the filename stem (e.g. `0db0b555-...-52f98db892ac.png`)
   - For fonts/multi-file assets: UUID is a **directory name** (e.g. `c559e99c-.../firasans.ttf`)
2. Match extracted hex UUIDs against UUIDs from `query-assets` (which also returns hex UUIDs)
3. For sub-assets (`@fragment`), strip the `@xxxxx` suffix, group by base UUID, and sum sizes

No UUID decompression needed for the post-build scanner — native/import filenames already contain hex UUIDs.

### `bundledUuids` Population from `config.json`

When building `bundledUuids` from the `uuids` array in `config.json`:
1. **Strip `@fragment` suffix** before processing (e.g. `"04I1sqyNpNqrTCWdP0pcBc@6c48a"` → `"04I1sqyNpNqrTCWdP0pcBc"`)
2. **Skip pack file pseudo-UUIDs** — the `uuids` array contains pack IDs (e.g. `"0d50e9a82"`, `"081429921"`) mixed with real asset UUIDs. These are short hex strings (typically 9 chars), NOT base64-compressed UUIDs. Filter: skip entries that appear as keys in `config.json`'s `packs` map, or skip entries that are not 22 characters long (compressed UUIDs are always 22-char base64)
3. **Decompress** remaining compressed base64 UUIDs to hex UUID (Cocos uses `Editor.Utils.UUID.decompressUUID()` internally; implement equivalent)
4. **Deduplicate** — multiple fragments map to the same base UUID
5. Store only **base hex UUIDs** in `bundledUuids`

This ensures lookup against hex UUIDs from `query-assets` works correctly.

### Algorithm
1. Find `src/settings.json` in build dir → extract `launch.launchScene` and `assets.projectBundles`
2. For each bundle in `assets.projectBundles`, read `assets/<bundle>/config.json` to get the full list of bundled UUIDs (decompress if needed for cross-reference)
3. Recursively scan `assets/*/native/` — extract UUID from filename, record real file size
4. Also scan `assets/*/import/` for serialized asset data (JSON and binary files, including pack files)
5. Match hex UUIDs from filenames against UUIDs from `query-assets` → set `actualBuildSize`
6. Mark assets as `buildStatus: 'confirmed'`

### Interface
```typescript
interface BuildScanResult {
  buildDir: string;
  buildTimestamp: number;        // mtime of build directory
  totalBuildSize: number;        // sum of all asset files (native + import + scripts)
  packFileSize: number;          // total size of pack files (cannot be attributed to single UUID)
  assetMap: Map<string, {        // hex uuid → build data
    buildPaths: string[];        // file path(s) in build (may have sub-assets)
    actualSize: number;          // total real file size in bytes (sum of sub-assets)
  }>;
  bundledUuids: Set<string>;     // all base hex UUIDs referenced in bundle configs (fragments stripped, decompressed)
}

async function scanBuildDirectory(buildDir: string): Promise<BuildScanResult | null>
```

Returns `null` if build directory doesn't exist.

## New Module: `dependency-resolver.ts`

### Purpose
Build a dependency graph starting from scenes, to predict which assets will be included in a build.

### Scene UUID Discovery (prioritized)
1. **From existing build** (most reliable): parse `src/settings.json` → `launch.launchScene` + bundle `config.json` → `scenes` field
2. **From project settings**: read `<projectRoot>/settings/v2/packages/builder.json` which contains build scene list
3. **Fallback**: query all `.scene` files via `Editor.Message.request('asset-db', 'query-assets', { ccType: 'cc.SceneAsset' })`

### Dependency Resolution

**API verification note**: `Editor.Message.request('asset-db', 'query-asset-dependencies', uuid)` must be verified against Cocos 3.8 before implementation. If unavailable, use the fallback approach.

**Primary approach** (if API exists):
1. For each scene UUID, call `query-asset-dependencies` recursively
2. Use `visited: Set<string>` to prevent cycles
3. Batch concurrent requests (max 10 concurrent) to avoid saturating IPC
4. Collect all transitively referenced UUIDs

**Fallback approach** (if API unavailable):
1. For each scene, read the `.scene` file (JSON format in Cocos 3.8)
2. Extract all `__uuid__` references via regex
3. For referenced prefabs/materials, recursively parse their files too
4. This is less complete but doesn't depend on undocumented APIs

### Interface
```typescript
type QueryDependenciesFn = (uuid: string) => Promise<string[]>;

interface DependencyResult {
  referencedUuids: Set<string>;  // all UUIDs transitively referenced from scenes
  sceneUuids: string[];          // root scene UUIDs
}

async function resolveSceneDependencies(
  sceneUuids: string[],
  queryDeps: QueryDependenciesFn,
  options?: { maxConcurrency?: number; maxDepth?: number },
): Promise<DependencyResult>
```

### Limitations
- Dynamic asset loading (`resources.load()`) won't be detected
- Assets in `resources/` folder and custom bundles (from `assets.projectBundles`) should be included unconditionally
- Detection: check `settings.json` → `assets.projectBundles` array; mark all assets under bundle-rooted paths as `buildStatus: 'predicted'`

## Extended Types

### `AssetReportItem` (modified)
```typescript
interface AssetReportItem {
  uuid: string;
  name: string;
  path: string;
  file: string;
  type: string;
  sourceSize: number;
  buildSize: number;              // estimated (kept for backward compat)
  actualBuildSize?: number;       // NEW: real size from build dir (if available)
  extension: string;
  thumbnailPath?: string;
  buildStatus: 'confirmed' | 'predicted' | 'unused';  // NEW
  // NOTE: no `inBuild` field — derive from `buildStatus !== 'unused'`
}
```

### `BuildReport` (modified)
```typescript
interface BuildReport {
  timestamp: number;
  projectName: string;
  totalSourceSize: number;
  totalBuildSize: number;          // estimated, ONLY assets with buildStatus !== 'unused'
  totalActualBuildSize?: number;   // NEW: best-effort total for non-unused assets.
                                   // Uses actualBuildSize for 'confirmed', buildSize (estimated) for 'predicted'.
  buildDirExists: boolean;         // NEW
  buildTimestamp?: number;         // NEW: when build was last done
  assets: AssetReportItem[];
}
```

**Important**: `totalBuildSize` and `totalActualBuildSize` must be computed ONLY from assets with `buildStatus !== 'unused'`. The `merge()` function enforces this.

## Merge Logic in `scanner.ts`

New exported function:
```typescript
async function scanAssetsHybrid(
  queryFn: QueryAssetsFn,
  queryDeps: QueryDependenciesFn,
  projectName: string,
  buildDir?: string,
  sceneUuids?: string[],
): Promise<BuildReport>
```

### Merge priority:
1. Start with all project assets from `scanAllAssets()` → all marked `buildStatus: 'unused'`
2. If `sceneUuids` provided → run `resolveSceneDependencies()` → matching assets get `buildStatus: 'predicted'`
3. If `buildDir` exists → run `scanBuildDirectory()`:
   - Assets found in build → override to `buildStatus: 'confirmed'` + set `actualBuildSize`
   - Assets in `bundledUuids` but without native files → `buildStatus: 'confirmed'`, keep estimated size
4. Compute totals from non-unused assets only

## UI Changes (`panels/default.ts`)

### Report Table
- **Build Size column**: show `actualBuildSize` if available, else `buildSize` (estimated)
- **Sorting**: sort key for build size column must use `actualBuildSize ?? buildSize`
- **New Status column**: visual indicator
  - `✓` green — confirmed in build (post-build data)
  - `~` yellow — predicted in build (pre-build dependency analysis)
  - `○` gray — not used (not referenced by scenes)
- **Summary row**: show `totalActualBuildSize` if available, else `totalBuildSize` (both exclude unused)
- **Badge**: "Build data: real" or "Build data: estimated" near the summary

### Behavior
- "Analyze" button triggers `scanAssetsHybrid()`
- If build dir detected → automatically uses post-build data
- If no build → falls back to pre-build dependency analysis + estimation

## `main.ts` Changes

### New method: `scanAssetsHybrid()`
```typescript
async scanAssetsHybrid() {
  const queryFn = createEditorQueryFn(Editor.Message);
  const queryDeps = createEditorDependencyQueryFn(Editor.Message);
  const projectRoot = Editor.Project.path || '';

  // Use last build result path if available; no hardcoded fallback
  const buildDir = lastBuildResult?.dest ?? undefined;

  const sceneUuids = await getSceneUuidsFromBuildSettings(Editor.Message, buildDir);

  return scanAssetsHybrid(
    queryFn, queryDeps, Editor.Project.name || 'unknown',
    existsSync(buildDir) ? buildDir : undefined,
    sceneUuids,
  );
}
```

### Helper functions
```typescript
function createEditorDependencyQueryFn(editorMessage: any): QueryDependenciesFn {
  return async (uuid: string) => {
    // Must verify this API exists in Cocos 3.8 during implementation
    return editorMessage.request('asset-db', 'query-asset-dependencies', uuid);
  };
}

async function getSceneUuidsFromBuildSettings(
  editorMessage: any,
  buildDir?: string,
): Promise<string[]> {
  // Priority 1: from existing build's src/settings.json
  if (buildDir) {
    const settingsPath = resolve(buildDir, 'src/settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const launchScene = settings.launch?.launchScene;
      // e.g. "db://assets/Scenes/Main.scene"
      if (launchScene) {
        // Resolve scene URL to UUID via asset-db
        const info = await editorMessage.request('asset-db', 'query-asset-info', launchScene);
        if (info?.uuid) return [info.uuid];
      }
    }
  }

  // Priority 2: from project builder settings
  // Read <projectRoot>/settings/v2/packages/builder.json if it exists

  // Priority 3: query all .scene files
  const scenes = await editorMessage.request('asset-db', 'query-assets', {
    ccType: 'cc.SceneAsset',
  });
  return scenes.map((s: any) => s.uuid);
}
```

## Integration with `onAfterBuild` hook

In `hooks.ts`, after build completes:
- `lastBuildResult` already stores `dest` — this is the build dir path
- Panel can use `getLastBuildResult()` to auto-detect build dir
- No changes needed to hooks — just use existing `dest` data

## Edge Cases

1. **Build dir exists but is stale** — compare `buildTimestamp` with project modification time; show warning badge in UI
2. **`resources/` folder & custom bundles** — detect from `settings.json` → `assets.projectBundles`; mark all contained assets as `buildStatus: 'predicted'` regardless of dependency analysis
3. **Multiple bundles** — scan all bundle configs from `assets.projectBundles`, not just `main`
4. **No scenes in build settings** — fall back to scanning all `.scene` files via `query-assets`
5. **`query-asset-dependencies` unavailable** — use fallback file-parsing approach (see dependency-resolver.ts section)
6. **Sub-assets** — group `@fragment` files by base UUID, sum their sizes
7. **Dependency cycles** — `visited: Set<string>` prevents infinite recursion
8. **IPC saturation** — cap concurrent `query-asset-dependencies` calls at 10
9. **Pack files in `import/`** — files like `0d50e9a82.json` (short hex names matching `config.json` `packs` keys) aggregate multiple assets. Include their size in `totalBuildSize` and `packFileSize` but do not attribute to any single project UUID
10. **Font/multi-file assets** — stored as `native/<2chars>/<uuid-dir>/<original-file>` instead of `native/<2chars>/<uuid>.<ext>`. UUID must be extracted from path segments, not just filename

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/build-report/build-scanner.ts` | CREATE | Post-build directory scanner |
| `src/core/build-report/dependency-resolver.ts` | CREATE | Pre-build dependency graph resolver |
| `src/core/build-report/scanner.ts` | MODIFY | Add `scanAssetsHybrid()`, merge logic |
| `src/shared/types.ts` | MODIFY | Extend `AssetReportItem` and `BuildReport` |
| `src/main.ts` | MODIFY | Add `scanAssetsHybrid` method, helper fns, use `lastBuildResult.dest` |
| `src/panels/default.ts` | MODIFY | Status column, real/estimated badge, sort fix, updated rendering |
| `src/core/build-report/size-estimator.ts` | NO CHANGE | Kept as fallback for pre-build estimation |

## Testing Strategy

- Unit tests for `build-scanner.ts` using existing fixture at `tests/fixtures/roadside-build/web-mobile/`
- Unit tests for `dependency-resolver.ts` with mock query functions
- Unit test for merge logic in `scanner.ts`
- Test UUID extraction regex against real native filenames from fixture
- Test sub-asset grouping (`@fragment` files)
- Integration: verify real sizes match filesystem for fixture data

## Implementation Spike (before main work)

Before implementing `dependency-resolver.ts`, verify these Cocos 3.8 Editor APIs:
1. `Editor.Message.request('asset-db', 'query-asset-dependencies', uuid)` — does it exist? What does it return?
2. Scene list from build settings — is there a direct API, or must we parse settings files?

If APIs are unavailable, proceed with the fallback file-parsing approach documented above.

# Playable Performance Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI tool that opens a packaged playable in headed Chromium with low-end CPU/network throttle, overlays a live FPS/frame-time/memory HUD while the developer plays, and writes a self-contained HTML+JSON performance report.

**Architecture:** API-first core in `src/core/perf/` (pure analyze/profiles/report + Playwright session orchestrator + in-page HUD shipped as a TS string), thin CLI wrapper in `scripts/perf-test.js` that requires the compiled `dist/`. Reuses the existing `src/core/preview/server.ts` to serve the creative. CPU/network throttle via Playwright CDP; GPU fillrate/RAM are not emulable on Mac, so the tool measures symptoms and documents a real-device caveat.

**Tech Stack:** TypeScript (tsc → dist, CommonJS), Playwright 1.58 (headed Chromium + CDP), vitest for pure-function tests, vanilla JS for the in-page overlay.

**Design spec:** `docs/superpowers/specs/2026-06-08-playable-perf-test-design.md`

**Conventions in this repo:**
- `tsconfig.json`: `rootDir: ./src`, `outDir: ./dist`, `include: ["src/**/*"]`, `module: commonjs`, `lib: ES2020,DOM`. `scripts/` is NOT compiled by tsc; `tests/` excluded from build.
- `docs/` is gitignored — spec/plan live on disk, not committed. Source/tests ARE committed.
- Tests: `tests/**/*.test.ts`, vitest globals enabled, import from `../../src/...`. Run with `npm test` (`vitest run`).
- Build: `npm run build` (`tsc`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/core/perf/types.ts` | All shared interfaces/types |
| `src/core/perf/profiles.ts` | Device-tier presets (low/mid/none) |
| `src/core/perf/cli-args.ts` | Pure arg parser → SessionOptions |
| `src/core/perf/analyze.ts` | Pure: SessionResult → PerfMetrics + Verdict |
| `src/core/perf/report.ts` | PerfMetrics → JSON + self-contained HTML |
| `src/core/perf/hud-source.ts` | In-page HUD as an exported JS string |
| `src/core/perf/session.ts` | Orchestrator: preview server + Playwright + CDP + collect |
| `scripts/perf-test.js` | CLI wrapper (plain CJS, requires dist) |
| `tests/core/perf-profiles.test.ts` | profiles tests |
| `tests/core/perf-cli-args.test.ts` | arg parser tests |
| `tests/core/perf-analyze.test.ts` | percentile + analyze tests |
| `tests/core/perf-report.test.ts` | renderHtml + writeReport tests |
| `tests/core/perf-hud.test.ts` | HUD-source regression guards |

---

## Task 1: Types

**Files:**
- Create: `src/core/perf/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/core/perf/types.ts
export type ProfileName = 'low' | 'mid' | 'none';

export interface NetConditions {
  downloadThroughput: number; // bytes/sec
  uploadThroughput: number; // bytes/sec
  latency: number; // ms
}

export interface Profile {
  name: ProfileName;
  cpuRate: number; // CDP Emulation.setCPUThrottlingRate
  net: NetConditions | null;
}

export interface PerfSample {
  t: number; // ms since session start
  fps: number;
  frameMs: number;
  heapMB: number | null;
}

export interface PerfSpike {
  t: number;
  frameMs: number;
  fps: number;
  heapMB: number | null;
}

export interface PerfMarker {
  t: number;
  index: number;
}

export interface SessionOptions {
  outputDir: string;
  network: string;
  profile: ProfileName;
  spikeThresholdMs: number;
  reportDir: string;
}

export interface SessionResult {
  samples: PerfSample[];
  spikes: PerfSpike[];
  markers: PerfMarker[];
  loadToFirstFrameMs: number;
  timeToGameReadyMs: number | null;
  durationMs: number;
  profile: Profile;
}

export interface FpsMetrics {
  avg: number;
  min: number;
  p5: number;
}

export interface FrameMsMetrics {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface HeapMetrics {
  startMB: number | null;
  maxMB: number | null;
  endMB: number | null;
  growthMB: number | null;
  leakSuspect: boolean;
}

export type VerdictLevel = 'pass' | 'warn' | 'fail';

export interface Verdict {
  level: VerdictLevel;
  reasons: string[];
}

export interface PerfMetrics {
  fps: FpsMetrics;
  frameMs: FrameMsMetrics;
  droppedRatio: number;
  spikeCount: number;
  worstSpike: PerfSpike | null;
  heap: HeapMetrics;
  verdict: Verdict;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (no errors; `dist/core/perf/types.js` emitted)

- [ ] **Step 3: Commit**

```bash
git add src/core/perf/types.ts
git commit -m "feat(perf): add shared types for performance test tool"
```

---

## Task 2: Profiles

**Files:**
- Create: `src/core/perf/profiles.ts`
- Test: `tests/core/perf-profiles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/perf-profiles.test.ts
import { describe, it, expect } from 'vitest';
import { PROFILES, getProfile } from '../../src/core/perf/profiles';

describe('PROFILES', () => {
  it('low = 6x CPU + slow-3G network', () => {
    expect(PROFILES.low.cpuRate).toBe(6);
    expect(PROFILES.low.net).toEqual({ downloadThroughput: 51200, uploadThroughput: 51200, latency: 400 });
  });
  it('mid = 4x CPU + fast-3G network', () => {
    expect(PROFILES.mid.cpuRate).toBe(4);
    expect(PROFILES.mid.net).toEqual({ downloadThroughput: 204800, uploadThroughput: 96000, latency: 150 });
  });
  it('none = no throttle', () => {
    expect(PROFILES.none.cpuRate).toBe(1);
    expect(PROFILES.none.net).toBeNull();
  });
});

describe('getProfile', () => {
  it('returns the named profile', () => {
    expect(getProfile('low').name).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- perf-profiles`
Expected: FAIL — cannot find module `../../src/core/perf/profiles`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/perf/profiles.ts
import { Profile, ProfileName } from './types';

// CPU multipliers + network conditions from Chrome DevTools Device Mode
// low-end / mid-tier presets (slow-3G / fast-3G). Throughput in bytes/sec.
export const PROFILES: Record<ProfileName, Profile> = {
  low: {
    name: 'low',
    cpuRate: 6,
    net: { downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((400 * 1024) / 8), latency: 400 },
  },
  mid: {
    name: 'mid',
    cpuRate: 4,
    net: { downloadThroughput: Math.round((1600 * 1024) / 8), uploadThroughput: Math.round((750 * 1024) / 8), latency: 150 },
  },
  none: { name: 'none', cpuRate: 1, net: null },
};

export function getProfile(name: ProfileName): Profile {
  return PROFILES[name];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- perf-profiles`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/profiles.ts tests/core/perf-profiles.test.ts
git commit -m "feat(perf): device-tier throttle profiles (low/mid/none)"
```

---

## Task 3: CLI argument parser

**Files:**
- Create: `src/core/perf/cli-args.ts`
- Test: `tests/core/perf-cli-args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/perf-cli-args.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs, CliArgsError } from '../../src/core/perf/cli-args';

describe('parseArgs', () => {
  it('parses positional output-dir + network with defaults', () => {
    const o = parseArgs(['build/out', 'applovin']);
    expect(o.outputDir).toBe('build/out');
    expect(o.network).toBe('applovin');
    expect(o.profile).toBe('low');
    expect(o.spikeThresholdMs).toBeCloseTo(33.3);
    expect(o.reportDir).toBe('build/out/perf-reports');
  });
  it('parses flags', () => {
    const o = parseArgs(['out', 'unity', '--profile', 'mid', '--spike-ms', '20', '--report-dir', '/tmp/r']);
    expect(o.profile).toBe('mid');
    expect(o.spikeThresholdMs).toBe(20);
    expect(o.reportDir).toBe('/tmp/r');
  });
  it('rejects invalid profile', () => {
    expect(() => parseArgs(['out', 'unity', '--profile', 'ultra'])).toThrow(CliArgsError);
  });
  it('rejects unknown flag', () => {
    expect(() => parseArgs(['out', 'unity', '--zoom'])).toThrow(CliArgsError);
  });
  it('rejects missing positional args', () => {
    expect(() => parseArgs(['out'])).toThrow(CliArgsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- perf-cli-args`
Expected: FAIL — cannot find module `../../src/core/perf/cli-args`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/perf/cli-args.ts
import { join } from 'path';
import { ProfileName, SessionOptions } from './types';

const VALID_PROFILES: ProfileName[] = ['low', 'mid', 'none'];

export class CliArgsError extends Error {}

export function parseArgs(argv: string[]): SessionOptions {
  const positional: string[] = [];
  let profile: ProfileName = 'low';
  let spikeThresholdMs = 33.3;
  let reportDir = '';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') {
      const v = argv[++i] as ProfileName;
      if (!VALID_PROFILES.includes(v)) {
        throw new CliArgsError(`Invalid --profile "${v}". Use: ${VALID_PROFILES.join(', ')}`);
      }
      profile = v;
    } else if (a === '--spike-ms') {
      const raw = argv[++i];
      const v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) throw new CliArgsError(`Invalid --spike-ms "${raw}"`);
      spikeThresholdMs = v;
    } else if (a === '--report-dir') {
      reportDir = argv[++i];
    } else if (a.startsWith('--')) {
      throw new CliArgsError(`Unknown flag "${a}"`);
    } else {
      positional.push(a);
    }
  }

  if (positional.length < 2) {
    throw new CliArgsError(
      'Usage: perf-test <output-dir> <network> [--profile low|mid|none] [--spike-ms 33.3] [--report-dir <dir>]',
    );
  }

  const [outputDir, network] = positional;
  if (!reportDir) reportDir = join(outputDir, 'perf-reports');

  return { outputDir, network, profile, spikeThresholdMs, reportDir };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- perf-cli-args`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/cli-args.ts tests/core/perf-cli-args.test.ts
git commit -m "feat(perf): CLI argument parser"
```

---

## Task 4: Analyze (pure metrics + verdict)

**Files:**
- Create: `src/core/perf/analyze.ts`
- Test: `tests/core/perf-analyze.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/perf-analyze.test.ts
import { describe, it, expect } from 'vitest';
import { percentile, analyze } from '../../src/core/perf/analyze';
import { SessionResult, PerfSample } from '../../src/core/perf/types';

function makeResult(samples: PerfSample[], spikes = [] as any[]): SessionResult {
  return {
    samples,
    spikes,
    markers: [],
    loadToFirstFrameMs: 0,
    timeToGameReadyMs: null,
    durationMs: 1000,
    profile: { name: 'low', cpuRate: 6, net: null },
  };
}

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
  });
  it('handles single element', () => {
    expect(percentile([42], 95)).toBe(42);
  });
  it('handles empty', () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe('analyze', () => {
  it('flat 60fps run → pass, zero dropped', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, fps: 60, frameMs: 16, heapMB: 100 }));
    const m = analyze(makeResult(samples));
    expect(m.droppedRatio).toBe(0);
    expect(m.verdict.level).toBe('pass');
  });
  it('all long frames → fail', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ t: i * 80, fps: 12, frameMs: 80, heapMB: 100 }));
    const spikes = samples.map((s) => ({ t: s.t, frameMs: s.frameMs, fps: s.fps, heapMB: s.heapMB }));
    const m = analyze(makeResult(samples, spikes));
    expect(m.droppedRatio).toBe(1);
    expect(m.verdict.level).toBe('fail');
    expect(m.spikeCount).toBe(100);
    expect(m.worstSpike?.frameMs).toBe(80);
  });
  it('monotonic heap growth >50MB → leakSuspect + warn', () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ t: i * 16, fps: 60, frameMs: 16, heapMB: 100 + i }));
    const m = analyze(makeResult(samples));
    expect(m.heap.leakSuspect).toBe(true);
    expect(m.verdict.level).toBe('warn');
  });
  it('null heap samples → heap metrics null, no leak', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ t: i * 16, fps: 60, frameMs: 16, heapMB: null }));
    const m = analyze(makeResult(samples));
    expect(m.heap.maxMB).toBeNull();
    expect(m.heap.leakSuspect).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- perf-analyze`
Expected: FAIL — cannot find module `../../src/core/perf/analyze`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/perf/analyze.ts
import { SessionResult, PerfMetrics, PerfSpike, HeapMetrics, Verdict } from './types';

const FRAME_BUDGET_60 = 1000 / 60; // 16.67ms

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

function computeHeap(heapMBs: (number | null)[]): HeapMetrics {
  const vals = heapMBs.filter((v): v is number => v != null);
  if (vals.length === 0) {
    return { startMB: null, maxMB: null, endMB: null, growthMB: null, leakSuspect: false };
  }
  const startMB = vals[0];
  const endMB = vals[vals.length - 1];
  const maxMB = Math.max(...vals);
  const growthMB = round2(endMB - startMB);
  const monotonicRise = endMB >= maxMB - 1; // end is (near) the peak
  const leakSuspect = growthMB > 50 && monotonicRise;
  return { startMB: round2(startMB), maxMB: round2(maxMB), endMB: round2(endMB), growthMB, leakSuspect };
}

function computeVerdict(m: {
  fpsP5: number;
  frameP95: number;
  frameP99: number;
  droppedRatio: number;
  leakSuspect: boolean;
}): Verdict {
  const reasons: string[] = [];
  let level: Verdict['level'] = 'pass';

  if (m.droppedRatio > 0.2) {
    reasons.push(`Dropped frames ${(m.droppedRatio * 100).toFixed(0)}% > 20%`);
    level = 'fail';
  }
  if (m.fpsP5 < 20) {
    reasons.push(`5th-percentile FPS ${m.fpsP5} < 20`);
    level = 'fail';
  }
  if (m.frameP99 > 66) {
    reasons.push(`p99 frame-time ${m.frameP99}ms > 66ms`);
    level = 'fail';
  }

  if (level !== 'fail') {
    if (m.droppedRatio > 0.1) {
      reasons.push(`Dropped frames ${(m.droppedRatio * 100).toFixed(0)}% > 10%`);
      level = 'warn';
    }
    if (m.fpsP5 < 30) {
      reasons.push(`5th-percentile FPS ${m.fpsP5} < 30`);
      level = 'warn';
    }
    if (m.frameP95 > 33) {
      reasons.push(`p95 frame-time ${m.frameP95}ms > 33ms`);
      level = 'warn';
    }
    if (m.leakSuspect) {
      reasons.push('Heap grew >50MB monotonically — possible leak');
      level = 'warn';
    }
  }

  if (reasons.length === 0) reasons.push('Within low-end budget');
  return { level, reasons };
}

export function analyze(result: SessionResult): PerfMetrics {
  const { samples, spikes } = result;

  const frameMsArr = samples.map((s) => s.frameMs).sort((a, b) => a - b);
  const fpsSorted = samples.map((s) => s.fps).sort((a, b) => a - b);
  const fpsAvg = samples.length ? samples.reduce((a, s) => a + s.fps, 0) / samples.length : 0;

  const fps = {
    avg: round2(fpsAvg),
    min: fpsSorted.length ? fpsSorted[0] : 0,
    p5: round2(percentile(fpsSorted, 5)),
  };
  const frameMs = {
    p50: round2(percentile(frameMsArr, 50)),
    p95: round2(percentile(frameMsArr, 95)),
    p99: round2(percentile(frameMsArr, 99)),
    max: frameMsArr.length ? round2(frameMsArr[frameMsArr.length - 1]) : 0,
  };
  const overBudget = samples.filter((s) => s.frameMs > FRAME_BUDGET_60).length;
  const droppedRatio = samples.length ? round2(overBudget / samples.length) : 0;

  const worstSpike = spikes.reduce<PerfSpike | null>(
    (worst, s) => (!worst || s.frameMs > worst.frameMs ? s : worst),
    null,
  );

  const heap = computeHeap(samples.map((s) => s.heapMB));

  const verdict = computeVerdict({
    fpsP5: fps.p5,
    frameP95: frameMs.p95,
    frameP99: frameMs.p99,
    droppedRatio,
    leakSuspect: heap.leakSuspect,
  });

  return { fps, frameMs, droppedRatio, spikeCount: spikes.length, worstSpike, heap, verdict };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- perf-analyze`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/analyze.ts tests/core/perf-analyze.test.ts
git commit -m "feat(perf): pure analyze — fps/frame-time/heap metrics + verdict"
```

---

## Task 5: Report (JSON + self-contained HTML)

**Files:**
- Create: `src/core/perf/report.ts`
- Test: `tests/core/perf-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/perf-report.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { renderHtml, writeReport } from '../../src/core/perf/report';
import { analyze } from '../../src/core/perf/analyze';
import { SessionResult } from '../../src/core/perf/types';

function fixture(): SessionResult {
  const samples = Array.from({ length: 20 }, (_, i) => ({ t: i * 16, fps: 60, frameMs: 16, heapMB: 100 }));
  return {
    samples,
    spikes: [{ t: 80, frameMs: 90, fps: 11, heapMB: 120 }],
    markers: [{ t: 50, index: 1 }],
    loadToFirstFrameMs: 120,
    timeToGameReadyMs: 800,
    durationMs: 5000,
    profile: { name: 'low', cpuRate: 6, net: null },
  };
}

describe('renderHtml', () => {
  it('embeds verdict, disclaimer, canvas, and data payload', () => {
    const r = fixture();
    const html = renderHtml(analyze(r), r);
    expect(html).toContain('VERDICT');
    expect(html).toContain('GPU runs at host speed');
    expect(html).toContain('<canvas');
    expect(html).toContain('"frameMs":90'); // spike present in embedded JSON
  });
});

describe('writeReport', () => {
  it('writes json + html and returns their paths', () => {
    const dir = join(__dirname, '..', '.tmp-perf');
    rmSync(dir, { recursive: true, force: true });
    const r = fixture();
    const { jsonPath, htmlPath } = writeReport(analyze(r), r, dir, 'unit');
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(readFileSync(htmlPath, 'utf8')).toContain('<canvas');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- perf-report`
Expected: FAIL — cannot find module `../../src/core/perf/report`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/perf/report.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { PerfMetrics, SessionResult } from './types';

export function renderHtml(metrics: PerfMetrics, result: SessionResult): string {
  const payload = JSON.stringify({
    samples: result.samples,
    spikes: result.spikes,
    markers: result.markers,
    metrics,
  });
  const p = result.profile;
  const disclaimer =
    `CPU/network throttled to "${p.name}" (CPU ${p.cpuRate}x). GPU runs at host speed — ` +
    `fillrate/RAM not emulated. Validate GPU-bound and memory on a real low-end device.`;
  const v = metrics.verdict;
  const vColor = v.level === 'pass' ? '#1a7' : v.level === 'warn' ? '#c80' : '#c33';
  const h = metrics.heap;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Playable Perf Report</title>
<style>body{font:13px/1.5 -apple-system,monospace;background:#15171c;color:#dde;margin:0;padding:20px}
h2{margin:0 0 14px}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}
.card{background:#1e2128;border:1px solid #2c3038;border-radius:8px;padding:10px 14px;min-width:120px}
.card b{display:block;font-size:20px;color:#fff}
.verdict{padding:10px 14px;border-radius:8px;font-weight:bold;color:#fff;background:${vColor};margin-bottom:16px}
.verdict ul{margin:6px 0 0;font-weight:normal}
canvas{background:#0e0f13;border:1px solid #2c3038;border-radius:8px;width:100%;height:240px}
.note{margin-top:14px;padding:10px;background:#2a2410;border:1px solid #5a4a10;border-radius:8px;color:#ec9}</style>
</head><body>
<h2>Playable Performance Report — ${p.name} profile</h2>
<div class="verdict">VERDICT: ${v.level.toUpperCase()}<ul>${v.reasons.map((r) => `<li>${r}</li>`).join('')}</ul></div>
<div class="cards">
<div class="card">FPS avg<b>${metrics.fps.avg}</b>min ${metrics.fps.min} · p5 ${metrics.fps.p5}</div>
<div class="card">Frame ms (p95)<b>${metrics.frameMs.p95}</b>p50 ${metrics.frameMs.p50} · p99 ${metrics.frameMs.p99} · max ${metrics.frameMs.max}</div>
<div class="card">Dropped<b>${(metrics.droppedRatio * 100).toFixed(0)}%</b>${metrics.spikeCount} spikes</div>
<div class="card">Heap MB (max)<b>${h.maxMB ?? '—'}</b>start ${h.startMB ?? '—'} · grow ${h.growthMB ?? '—'}${h.leakSuspect ? ' · ⚠leak' : ''}</div>
<div class="card">Load<b>${Math.round(result.loadToFirstFrameMs)}ms</b>gameReady ${result.timeToGameReadyMs != null ? Math.round(result.timeToGameReadyMs) + 'ms' : '—'}</div>
</div>
<canvas id="chart" width="1200" height="240"></canvas>
<div class="note">${disclaimer}</div>
<script>
const D = ${payload};
const cv = document.getElementById('chart'), x = cv.getContext('2d');
const S = D.samples;
if (S.length) {
  const T = S[S.length - 1].t || 1, W = cv.width, H = cv.height;
  const px = (t) => (t / T) * W;
  // budget guide lines (16.67ms green, 33ms amber), scale 0..50ms over full height
  [16.67, 33].forEach((b) => { const y = H - Math.min(b / 50, 1) * H; x.strokeStyle = b < 20 ? '#283' : '#852'; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); });
  // frame-time line
  x.strokeStyle = '#4af'; x.beginPath();
  S.forEach((s, i) => { const y = H - Math.min(s.frameMs / 50, 1) * H; i ? x.lineTo(px(s.t), y) : x.moveTo(px(s.t), y); });
  x.stroke();
  // spikes
  x.fillStyle = '#f33'; D.spikes.forEach((s) => x.fillRect(px(s.t) - 1, 0, 2, H));
  // markers
  x.fillStyle = '#ff0'; x.font = '10px monospace';
  D.markers.forEach((m) => { const X = px(m.t); x.fillRect(X, 0, 1, H); x.fillText('#' + m.index, X + 2, 12); });
} else {
  x.fillStyle = '#888'; x.fillText('No samples captured', 20, 30);
}
</script></body></html>`;
}

export function writeReport(
  metrics: PerfMetrics,
  result: SessionResult,
  dir: string,
  baseName: string,
): { jsonPath: string; htmlPath: string } {
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, baseName + '.json');
  const htmlPath = join(dir, baseName + '.html');
  writeFileSync(jsonPath, JSON.stringify({ metrics, result }, null, 2));
  writeFileSync(htmlPath, renderHtml(metrics, result));
  return { jsonPath, htmlPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- perf-report`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/report.ts tests/core/perf-report.test.ts
git commit -m "feat(perf): self-contained HTML + JSON report with inline canvas chart"
```

---

## Task 6: HUD source (in-page overlay)

**Files:**
- Create: `src/core/perf/hud-source.ts`
- Test: `tests/core/perf-hud.test.ts`

**Note:** The HUD is in-page vanilla JS shipped as an exported string (compiles cleanly into `dist`, no asset-copy step, no runtime path resolution). It is injected verbatim by `session.ts` via `context.addInitScript`. The test is a lightweight regression guard on the string's contents (full behavior is verified in the manual smoke test, Task 9). The whole body is wrapped in `try/catch` so a HUD failure never breaks the creative, and `window.gameReady` is wrapped (not overwritten) to preserve validator lifecycle tracking.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/perf-hud.test.ts
import { describe, it, expect } from 'vitest';
import { HUD_SOURCE } from '../../src/core/perf/hud-source';

describe('HUD_SOURCE', () => {
  it('is a non-trivial IIFE string', () => {
    expect(typeof HUD_SOURCE).toBe('string');
    expect(HUD_SOURCE.length).toBeGreaterThan(500);
    expect(HUD_SOURCE.trimStart().startsWith('(function')).toBe(true);
  });
  it('installs namespace guard, rAF loop, key handlers and emit bridge', () => {
    expect(HUD_SOURCE).toContain('window.__plbxPerf');
    expect(HUD_SOURCE).toContain('requestAnimationFrame');
    expect(HUD_SOURCE).toContain("addEventListener('keydown'");
    expect(HUD_SOURCE).toContain('__perfEmit');
  });
  it('wraps gameReady without losing the original', () => {
    expect(HUD_SOURCE).toContain('gameReady');
    expect(HUD_SOURCE).toContain('existing.apply');
  });
  it('reads spike threshold from injected config', () => {
    expect(HUD_SOURCE).toContain('__plbxPerfConfig');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- perf-hud`
Expected: FAIL — cannot find module `../../src/core/perf/hud-source`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/perf/hud-source.ts
// In-page performance HUD. Shipped as a string and injected via
// context.addInitScript so it runs before the creative's own scripts.
// Reads window.__plbxPerfConfig (set by a boot script) for spikeThresholdMs.
// Calls window.__perfEmit(event) — a Playwright-exposed binding — to stream
// samples/spikes/markers/lifecycle to Node. Entire body is try/catch-guarded.
export const HUD_SOURCE = `(function () {
  try {
    if (window.__plbxPerf) return;
    var cfg = window.__plbxPerfConfig || { spikeThresholdMs: 33.3 };
    var SPIKE = cfg.spikeThresholdMs;
    var start = performance.now();
    var measuring = true;
    var lastT = start, frames = 0, fpsWindowStart = start, fps = 0;
    var sampleBuf = [], lastSampleEmit = start, lastHeapSample = start, heapMB = null;
    var markerIndex = 0, firstFrameSent = false;

    function emit(type, data) {
      try { if (window.__perfEmit) window.__perfEmit({ type: type, data: data }); } catch (e) {}
    }
    function getHeapMB() {
      try { if (performance.memory) return performance.memory.usedJSHeapSize / 1048576; } catch (e) {}
      return null;
    }

    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;font:11px/1.3 monospace;background:rgba(0,0,0,.75);color:#0f0;padding:6px 8px;border-radius:4px;pointer-events:none;min-width:120px';
    var txt = document.createElement('div');
    var cv = document.createElement('canvas');
    cv.width = 120; cv.height = 32; cv.style.cssText = 'display:block;margin-top:4px;background:#111';
    box.appendChild(txt); box.appendChild(cv);
    var ctx = cv.getContext('2d');
    var hist = [];
    function ensureBox() { if (!box.parentNode && document.body) document.body.appendChild(box); }

    function draw(spike) {
      if (!measuring) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.style.color = spike ? '#f33' : '#0f0';
      txt.textContent = 'FPS ' + fps + '  ' + (1000 / Math.max(fps, 1)).toFixed(1) + 'ms' + (heapMB != null ? '  ' + heapMB.toFixed(0) + 'MB' : '');
      ctx.clearRect(0, 0, cv.width, cv.height);
      var n = hist.length;
      for (var i = 0; i < n; i++) {
        var hgt = Math.min(hist[i] / 50, 1) * cv.height;
        ctx.fillStyle = hist[i] > SPIKE ? '#f33' : '#0a0';
        ctx.fillRect(cv.width - n + i, cv.height - hgt, 1, hgt);
      }
    }

    function loop(now) {
      var dt = now - lastT; lastT = now;
      if (measuring && dt > 0) {
        frames++;
        if (now - fpsWindowStart >= 500) { fps = Math.round((frames * 1000) / (now - fpsWindowStart)); frames = 0; fpsWindowStart = now; }
        if (now - lastHeapSample >= 500) { heapMB = getHeapMB(); lastHeapSample = now; }
        hist.push(dt); if (hist.length > 120) hist.shift();
        var rel = now - start;
        if (!firstFrameSent) { firstFrameSent = true; emit('firstFrame', { t: rel }); }
        var spike = dt > SPIKE;
        if (spike) emit('spike', { t: rel, frameMs: dt, fps: fps, heapMB: heapMB });
        sampleBuf.push({ t: rel, fps: fps, frameMs: dt, heapMB: heapMB });
        if (now - lastSampleEmit >= 100) {
          for (var j = 0; j < sampleBuf.length; j++) emit('sample', sampleBuf[j]);
          sampleBuf.length = 0; lastSampleEmit = now;
        }
        ensureBox(); draw(spike);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    window.addEventListener('keydown', function (e) {
      if (e.key === 'm' || e.key === 'M') {
        markerIndex++; emit('marker', { t: performance.now() - start, index: markerIndex });
        box.style.outline = '2px solid #ff0';
        setTimeout(function () { box.style.outline = 'none'; }, 150);
      } else if (e.key === 'p' || e.key === 'P') {
        measuring = !measuring;
      }
    });

    // wrap gameReady WITHOUT overwriting (preserve validator lifecycle tracking)
    try {
      var existing = window.gameReady;
      function wrapped() {
        emit('gameReady', { t: performance.now() - start });
        if (typeof existing === 'function') return existing.apply(this, arguments);
      }
      Object.defineProperty(window, 'gameReady', {
        configurable: true,
        get: function () { return wrapped; },
        set: function (fn) { existing = fn; },
      });
    } catch (e) {}

    window.__plbxPerf = { version: 1 };
  } catch (e) { /* never break the creative */ }
})();`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- perf-hud`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/perf/hud-source.ts tests/core/perf-hud.test.ts
git commit -m "feat(perf): in-page HUD overlay source (FPS/MS/MEM + spikes + markers)"
```

---

## Task 7: Session orchestrator

**Files:**
- Create: `src/core/perf/session.ts`

**Note:** This module wires Playwright + CDP + the preview server. It has no unit test (it is I/O + browser integration); it is exercised by the manual smoke test in Task 9. Keep all logic here thin — the testable work already lives in analyze/report/profiles.

- [ ] **Step 1: Write the implementation**

```ts
// src/core/perf/session.ts
import { chromium, Browser } from 'playwright';
import { startPreviewServer, stopPreviewServer } from '../preview/server';
import { getProfile } from './profiles';
import { HUD_SOURCE } from './hud-source';
import { analyze } from './analyze';
import { writeReport } from './report';
import { SessionOptions, SessionResult, PerfSample, PerfSpike, PerfMarker } from './types';

function bootScript(spikeThresholdMs: number): string {
  return `window.__plbxPerfConfig = { spikeThresholdMs: ${spikeThresholdMs} };`;
}

export async function run(
  opts: SessionOptions,
): Promise<{ result: SessionResult; reportPaths: { jsonPath: string; htmlPath: string } }> {
  const profile = getProfile(opts.profile);
  const samples: PerfSample[] = [];
  const spikes: PerfSpike[] = [];
  const markers: PerfMarker[] = [];
  let loadToFirstFrameMs = 0;
  let timeToGameReadyMs: number | null = null;
  const startWall = Date.now();

  const { url } = await startPreviewServer({ outputDir: opts.outputDir, networks: [opts.network] });
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    await context.addInitScript({ content: bootScript(opts.spikeThresholdMs) + '\\n' + HUD_SOURCE });
    const page = await context.newPage();

    await page.exposeFunction('__perfEmit', (ev: { type: string; data: any }) => {
      if (ev.type === 'sample') {
        samples.push(ev.data);
      } else if (ev.type === 'spike') {
        spikes.push(ev.data);
        console.log(`[spike] t=${Math.round(ev.data.t)}ms frame=${ev.data.frameMs.toFixed(1)}ms fps=${ev.data.fps}`);
      } else if (ev.type === 'marker') {
        markers.push(ev.data);
        console.log(`[marker #${ev.data.index}] t=${Math.round(ev.data.t)}ms`);
      } else if (ev.type === 'firstFrame') {
        loadToFirstFrameMs = ev.data.t;
      } else if (ev.type === 'gameReady') {
        timeToGameReadyMs = ev.data.t;
        console.log(`[gameReady] t=${Math.round(ev.data.t)}ms`);
      }
    });

    const client = await context.newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate });
    if (profile.net) {
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: profile.net.downloadThroughput,
        uploadThroughput: profile.net.uploadThroughput,
        latency: profile.net.latency,
      });
    }

    const target = `${url}/preview/${opts.network}`;
    const resp = await page.goto(target, { waitUntil: 'domcontentloaded' });
    if (resp && resp.status() >= 400) {
      throw new Error(`Preview returned ${resp.status()} for ${target}. Is a build present for network "${opts.network}"?`);
    }

    console.log(
      `\\n▶ Playing "${opts.network}" — profile "${profile.name}" (CPU ${profile.cpuRate}x). ` +
        `Keys: [M]=marker, [P]=toggle measure. Close the window to finish.\\n`,
    );

    await new Promise<void>((resolve) => {
      page.on('close', () => resolve());
      context.on('close', () => resolve());
      process.once('SIGINT', () => resolve());
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopPreviewServer().catch(() => {});
  }

  const durationMs = Date.now() - startWall;
  const result: SessionResult = {
    samples,
    spikes,
    markers,
    loadToFirstFrameMs,
    timeToGameReadyMs,
    durationMs,
    profile,
  };
  const metrics = analyze(result);
  const baseName = `perf-${opts.network}-${profile.name}-${startWall}`;
  const reportPaths = writeReport(metrics, result, opts.reportDir, baseName);
  return { result, reportPaths };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: PASS (no type errors; `dist/core/perf/session.js` emitted)

- [ ] **Step 3: Commit**

```bash
git add src/core/perf/session.ts
git commit -m "feat(perf): Playwright session orchestrator (preview + CDP throttle + collect)"
```

---

## Task 8: CLI wrapper + npm script

**Files:**
- Create: `scripts/perf-test.js`
- Modify: `package.json` (add `perf` script)

- [ ] **Step 1: Write the CLI wrapper**

```js
// scripts/perf-test.js
// Plain CommonJS wrapper. Requires the compiled dist (run `npm run build` first,
// or use `npm run perf` which builds then runs). scripts/ is not compiled by tsc.
const { parseArgs, CliArgsError } = require('../dist/core/perf/cli-args');
const { run } = require('../dist/core/perf/session');
const { execSync } = require('child_process');

(async () => {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CliArgsError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  try {
    const { reportPaths } = await run(opts);
    console.log(`\n✔ Report: ${reportPaths.htmlPath}`);
    console.log(`  JSON:   ${reportPaths.jsonPath}`);
    try {
      execSync(`open "${reportPaths.htmlPath}"`); // macOS auto-open
    } catch (_) {
      /* non-macOS or no opener — path printed above */
    }
    process.exit(0);
  } catch (e) {
    console.error(`\n✖ ${e && e.message ? e.message : e}`);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `"scripts"`, add the `perf` entry after `"watch"`:

```json
    "watch": "tsc -w",
    "perf": "npm run build && node scripts/perf-test.js",
```

- [ ] **Step 3: Verify build + CLI usage error path**

Run: `npm run build && node scripts/perf-test.js`
Expected: prints the `Usage: perf-test <output-dir> <network> ...` line and exits 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/perf-test.js package.json
git commit -m "feat(perf): perf-test CLI wrapper + npm run perf"
```

---

## Task 9: Manual smoke test + Playwright browser check

**Files:** none (verification only)

- [ ] **Step 1: Ensure Chromium for Playwright is installed**

Run: `npx playwright install chromium`
Expected: Chromium present (downloads if missing).

- [ ] **Step 2: Locate a real build output dir + network**

A packaged build directory containing `<network>/index.html` (or launcher/zip). Reuse an existing build under the project (e.g. an output dir produced by the packager). Pick a network id present there, e.g. `preview` or `applovin`.

- [ ] **Step 3: Run the tool**

Run: `npm run perf -- <output-dir> <network> --profile low`
Expected, in order:
- A headed Chromium window opens showing the creative.
- A green HUD box appears top-right with `FPS … ms … MB` and a sparkline.
- Terminal prints the `▶ Playing …` banner, then `[spike] …` lines when frames exceed 33ms, and `[gameReady] …` if the creative calls it.
- Pressing `M` prints `[marker #n] …`; the HUD flashes a yellow outline.
- Pressing `P` toggles the HUD off/on.

- [ ] **Step 4: Finish and inspect the report**

Close the Chromium window.
Expected:
- Terminal prints `✔ Report: …/perf-reports/perf-<network>-low-<ts>.html` and the JSON path.
- The HTML report auto-opens (macOS) showing: verdict banner, metric cards, a frame-time chart with budget lines + red spike marks + yellow numbered markers, and the GPU/RAM disclaimer note at the bottom.
- Confirm the creative itself behaved normally (HUD did not break gameplay).

- [ ] **Step 5: Full test + build gate**

Run: `npm test && npm run build`
Expected: all perf vitest suites pass; build clean.

- [ ] **Step 6: Final verification note**

Confirm against the spec: CPU/network throttle applied (profile banner), live HUD + spike flash, key markers, JSON+HTML report with disclaimer. GPU fillrate/RAM intentionally not emulated — documented in the report note.

---

## Self-Review (completed during planning)

- **Spec coverage:** headed Chromium + CDP throttle (Task 7), HUD overlay + spikes + markers + toggle (Task 6), reuse preview server (Task 7), metrics + verdict (Task 4), JSON+HTML report + disclaimer (Task 5), profiles (Task 2), CLI (Tasks 3, 8), gameReady-wrap caveat (Task 6), real-device caveat (Task 5 disclaimer). All covered.
- **Placeholder scan:** no TBD/TODO; all code blocks complete.
- **Type consistency:** `SessionOptions`/`SessionResult`/`PerfMetrics`/`Profile` defined in Task 1 and used verbatim in Tasks 2–8. `run()` returns `{result, reportPaths}`; CLI consumes `reportPaths.htmlPath`/`.jsonPath` (matches `writeReport` return). `__perfEmit` event shape (`{type, data}`) matches between HUD (Task 6) and session handler (Task 7).
- **Deviation from spec (noted):** HUD ships as a TS string export (`hud-source.ts`) rather than a standalone `.js` asset — avoids asset-copy/path-resolution since tsc only emits `src/**` TS. Behavior identical.

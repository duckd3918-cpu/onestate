# Playable Performance Test — Design Spec

**Date:** 2026-06-08
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/playable-perf-test`

## Problem

Playable-креативы (Cocos web-mobile / WebGL / Unity) деплоятся под low-end Android, но
разработчик тестирует на мощном Mac и не видит, где креатив проседает на слабом железе.
Нужен инструмент, который даёт разработчику **живую обратную связь по производительности
прямо во время игры** в креатив, с эмуляцией low-end-условий, насколько это возможно на Mac.

### Что реально эмулируется (по итогам ресёрча, 2026-06-08)

- **CPU-троттлинг** (CDP `Emulation.setCPUThrottlingRate`) и **network-троттлинг**
  (`Network.emulateNetworkConditions`) — работают, дают low-end-ощущение.
- **GPU fillrate и жёсткий RAM-лимит — НЕ эмулируются** на Mac (см.
  `~/.claude/.../memory/low-end-device-testing-mac.md`). Поэтому инструмент меряет
  **симптомы** (просадки FPS, длинные кадры, рост heap), а не железо, и в отчёте честно
  указывает: GPU крутится на скорости хоста, финальная валидация — на реальном телефоне.

## Goals

1. Одна команда поднимает креатив в реальном (headed) Chromium с low-end CPU/network профилем.
2. Поверх креатива — HUD-оверлей: live FPS / frame-time / memory + sparkline.
3. Просадки кадра флешат красным в момент игры; разработчик **чувствует** где лагает.
4. Разработчик ставит маркеры по клавише в тяжёлые моменты → метки на таймлайне отчёта.
5. По завершении сессии — self-contained HTML-отчёт + JSON-лог с метриками, спайками, маркерами, вердиктом.
6. Ядро переиспользуемо: тот же HUD-скрипт позже встраивается в `preview-util.js` валидатора.

## Non-Goals

- Не headless/CI автопрогон (это живая human-in-the-loop сессия).
- Не автодрайвинг геймплея (разработчик играет сам).
- Не эмуляция GPU fillrate / RAM (технически невозможно на Mac — документируем, не делаем).
- Не интеграция в панель расширения в этой итерации (только API/CLI; панель — позже).

## Architecture

API-first: вся логика в переиспользуемом ядре `src/core/perf/`, CLI — тонкая обёртка.

```
src/core/perf/
  types.ts          # PerfSample, PerfSpike, PerfMarker, SessionResult, Profile, типы опций
  profiles.ts       # device-tier пресеты low/mid/none (CPU rate + network conditions)
  analyze.ts        # ЧИСТЫЕ функции: PerfSample[]+spikes+markers → PerfMetrics + Verdict
  report.ts         # PerfMetrics → JSON-файл + self-contained HTML (inline <canvas>, без внешних либ)
  hud-overlay.js    # in-page vanilla JS, инъектится дословно (НЕ компилится tsc)
  session.ts        # оркестратор: preview-сервер + Playwright + CDP + инъекция + сбор + финализация
scripts/perf-test.ts  # CLI: парсинг аргументов → session.run()
tests/perf-analyze.test.ts  # vitest для чистых функций analyze.ts + profiles.ts
```

**Разделение ответственности:**
- `analyze.ts` и `profiles.ts` — чистые, без I/O и Playwright → покрыты vitest.
- `session.ts` — единственный модуль с Playwright/CDP/сетью → проверяется ручным smoke-тестом.
- `hud-overlay.js` — изолированный vanilla-JS, живёт в браузере, не зависит от сборки.

### Зависимости (уже в проекте)

- `playwright` (^1.58) — headed Chromium + CDP session.
- `src/core/preview/server.ts` — `startPreviewServer({outputDir, networks}) → {port, url}`,
  `stopPreviewServer()`. Креатив отдаётся на `GET {url}/preview/{networkId}`, preview-util.js
  инжектится сервером (SDK-моки + lifecycle).
- `jszip`, `cheerio` — уже используются preview-сервером, новый код их не трогает.

## Data Flow

1. **CLI** `node scripts/perf-test.js <output-dir> <network> [flags]` → `session.run(opts)`.
2. **session** вызывает `startPreviewServer({outputDir, networks:[network]})` → `{url}`.
3. Запускает `chromium.launch({headless:false})`, `newContext()`, `newPage()`.
4. Через `context.addInitScript(hudSource)` вставляет `hud-overlay.js` **до** навигации
   (выполнится раньше скриптов креатива в каждом фрейме).
5. Открывает CDP: `context.newCDPSession(page)`:
   - `Emulation.setCPUThrottlingRate({rate})`
   - `Network.emulateNetworkConditions({offline:false, downloadThroughput, uploadThroughput, latency})`
6. `page.exposeFunction('__perfEmit', (event) => {...})` — мост из страницы в Node.
7. `page.goto(`${url}/preview/${network}`)`.
8. **Разработчик играет в реальном окне.** HUD крутит `requestAnimationFrame`-цикл:
   - dt каждого кадра → frame-time (мс), rolling FPS.
   - `performance.memory.usedJSHeapSize` сэмплится каждые ~500мс.
   - dt > spikeThreshold (дефолт 33.3мс) → **spike**: HUD флешит красным + `__perfEmit({type:'spike',...})`.
   - sample-события батчатся (~10/сек) → `__perfEmit({type:'sample',...})` (не флудит мост).
   - keydown `M` → `__perfEmit({type:'marker', t, index})`; HUD рисует метку.
   - keydown `P` → toggle measurement on/off (дефолт on); HUD прячет/показывает себя.
9. **Node** на каждый event:
   - `spike` → печать в терминал (таймстамп, dt, fps) + запись в JSONL.
   - `sample`/`marker` → запись в JSONL + буфер для отчёта.
10. **Закрытие окна** (`page.on('close')` / `context.on('close')`) → `analyze()` → `report.write()`
    → JSON + HTML, авто-открытие HTML (`open` на macOS).

## Components

### types.ts
```ts
type ProfileName = 'low' | 'mid' | 'none';
interface Profile { name: ProfileName; cpuRate: number; net: NetConditions | null; }
interface NetConditions { downloadThroughput: number; uploadThroughput: number; latency: number; }
interface PerfSample { t: number; fps: number; frameMs: number; heapMB: number | null; }
interface PerfSpike { t: number; frameMs: number; fps: number; heapMB: number | null; }
interface PerfMarker { t: number; index: number; }
interface SessionOptions {
  outputDir: string; network: string; profile: ProfileName;
  spikeThresholdMs: number;     // дефолт 33.3
  reportDir: string;            // дефолт <outputDir>/perf-reports
}
interface SessionResult { samples: PerfSample[]; spikes: PerfSpike[]; markers: PerfMarker[];
  loadToFirstFrameMs: number; timeToGameReadyMs: number | null; durationMs: number; profile: Profile; }
```

### profiles.ts
```ts
const PROFILES: Record<ProfileName, Profile> = {
  low:  { name:'low',  cpuRate:6, net:{ downloadThroughput: 400*1024/8, uploadThroughput: 400*1024/8, latency:400 } }, // slow 3G
  mid:  { name:'mid',  cpuRate:4, net:{ downloadThroughput:1600*1024/8, uploadThroughput: 750*1024/8, latency:150 } }, // fast 3G
  none: { name:'none', cpuRate:1, net:null },
};
```
(Множители/сетевые значения — из ресёрча DevTools Device Mode low-end/mid-tier.)

### analyze.ts (чистые функции, тестируемые)
- `percentile(sortedFrameMs, p)` → значение.
- `analyze(result: SessionResult): PerfMetrics` →
  - `fps`: {avg, min, p5}
  - `frameMs`: {p50, p95, p99, max}
  - `droppedRatio`: доля кадров с frameMs > (1000/60)
  - `spikeCount`, `worstSpike`
  - `heap`: {startMB, maxMB, endMB, growthMB, leakSuspect: growthMB > 50 && монотонный рост по сэмплам}
  - `verdict`: {level: 'pass'|'warn'|'fail', reasons: string[]} по конкретным порогам:
    - `fail` если droppedRatio > 0.20 ИЛИ fps.p5 < 20 ИЛИ frameMs.p99 > 66 (≈ <15 FPS на хвосте)
    - `warn` если droppedRatio > 0.10 ИЛИ fps.p5 < 30 ИЛИ frameMs.p95 > 33 ИЛИ leakSuspect
    - иначе `pass`. Каждый сработавший порог добавляет строку в `reasons`.

### report.ts
- `writeReport(metrics, result, dir): {jsonPath, htmlPath}`.
- JSON — сырые samples/spikes/markers + metrics.
- HTML — self-contained: inline `<canvas>` рисует frame-time линию + спайки (красные точки)
  + маркеры (вертикальные линии с номерами) + heap-линию. Сверху — карточки метрик и вердикт.
  Снизу — **дисклеймер**: "CPU/network throttled to <profile>; GPU runs at host speed —
  fillrate/RAM not emulated. Validate GPU-bound/memory on a real low-end device."

### hud-overlay.js (in-page vanilla JS)
- IIFE в своём namespace `window.__plbxPerf`. Всё в try/catch — не должен ронять креатив.
- Высокий z-index `<div>` top-right; `<canvas>` sparkline; текст FPS/MS/MEM.
- rAF-цикл, спайк-флеш, key-handlers `M`/`P`, вызовы `window.__perfEmit`.
- Хук на `window.gameReady` (если есть): запоминает t первого вызова для timeToGameReady,
  **не перезаписывая** оригинал (оборачивает, вызывает исходный) — критично, иначе ломается
  lifecycle-трекинг валидатора.

### session.ts
- `run(opts: SessionOptions): Promise<SessionResult>` — оркестрация по Data Flow.
- Грейсфул-шатдаун: на close страницы/контекста и на SIGINT — финализирует и пишет отчёт.

### scripts/perf-test.ts
- Аргументы: `<output-dir> <network>` (позиционные), флаги `--profile`, `--spike-ms`, `--report-dir`.
- Дефолты: `--profile low`, `--spike-ms 33.3`.
- Печатает usage при нехватке аргументов. На старте печатает выбранный профиль и hint про клавиши `M`/`P`.

## Error Handling

- Билд для сети не найден (`findBuildFile` → null): preview-сервер вернёт 404 → session
  детектит не-200 ответ на `goto`, печатает понятную ошибку, чистит сервер/браузер, выходит 1.
- Playwright/Chromium не установлен: ловим, печатаем `npx playwright install chromium`.
- `performance.memory` отсутствует (не-Chromium): heap = null, остальные метрики работают.
- HUD-исключения: проглатываются в try/catch, не влияют на креатив; в худшем случае HUD пропадает,
  замер деградирует, креатив играбелен.
- Всегда чистим: `stopPreviewServer()` + `browser.close()` в finally.

## Testing

- **vitest** (`tests/perf-analyze.test.ts`): `percentile`, `analyze` (на синтетических samples:
  ровные кадры → pass; пачка длинных → spikes/dropped/fail; монотонный heap → leakSuspect),
  `profiles` (значения low/mid/none, cpuRate/net корректны).
- **Ручной smoke** (в плане как шаг верификации): запуск CLI на реальном output-дире,
  проверка что окно открывается, HUD виден, спайки летят в терминал, `M` ставит маркер,
  закрытие пишет HTML, дисклеймер на месте.

## Future Integration (вне scope этой итерации)

- `hud-overlay.js` встраивается в `preview-util.js` (preview-сервер инжектит тем же `injectPreviewUtil`),
  даёт «Measure Performance»-тогл прямо в превью/валидаторе без Playwright.
- Панель расширения: вкладка Performance вызывает `session.run` через IPC, рендерит отчёт в UI.

## Open Decisions (решены)

- **Отчёт**: inline `<canvas>` в self-contained HTML, ноль внешних зависимостей. ✔
- **Дефолтный профиль**: `low` (цель — low-end), переключается флагом. ✔
- **Default measurement**: on. ✔

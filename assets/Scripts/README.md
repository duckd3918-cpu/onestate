# OneState Playable — Wiring Guide v2

Все скрипты в `assets/Scripts/`. Логика линейная, интерактив в 1 точке (документы).

---

## Новые скрипты (добавлено в v2)

| Файл | Что делает |
|---|---|
| `TapToPlayController.ts` | Экран "Tap to Play" — игра не стартует пока не тапнул |
| `CarDriveController.ts` | Движение + вращение колёс (включая единый задний цилиндр) |
| `OfficerArmController.ts` | Поднимает правую руку офицера (raiseDuration=0.9 — натурально) |
| `DocumentCheckUI.ts` | Полностью переработан — checkbutton→inProgress→check/error, pop анимации |
| `PersistentUI.ts` | Логотип и Play Now всегда видны |
| `GameFlowController.ts` | Главный режиссёр — TapToPlay, все 3 фазы, аудио |

---

## Таймлайн

```
[Tap to Play]
  → Midnight loop начинается сразу при загрузке

[Фаза 1: 0–5s]
  0.0s  Машина едет (CarDriveController.startDrive)
  1.2s  Офицер поднимает руку (OfficerArmController.playStopGesture, 0.9s подъём)
  3.5s  Машина остановилась → car stop SFX + good evening аудио
  4.1s  Голова водителя поворачивается к офицеру
  Субтитры: "Good evening. Do you know how fast you were going?"
            потом: "License and registration please."

[Фаза 2: 5–18s]
  DocumentCheckUI активируется:
  - Пять полей: Field_Name, Field_DOB, Field_Issue, Field_Reg, Field_Expire
  - Последнее поле = ERROR → WANTED
  - Подсказка (FingerHint) появляется через 3s бездействия
  - Progress bar иллюзия: заполняется на 25% после каждого check (4 поля = 100%)
  - При ERROR: тряска плашки, штамп WANTED падает, красные вспышки, сирена
  Субтитры: "Let's see here." (начало), "Let's keep it simple." (arrest)

[Фаза 3: 18–30s]
  - Офицер стучит в дверь (OfficerKnockController)
  - Swap водителя (ArrestedPoseController)
  - Камера отъезжает (zoom out, 3 сек)
  - Outro звук
  - Деньги bounce ($25,000)
  - Fade to black → EndCard
```

---

## Сборка в Inspector

### Canvas → TapToPlayPanel (новая нода)

Создай внутри Canvas ноду `TapToPlayPanel`:
- Добавь компонент `TapToPlayController`
- Внутри создай:
  - `BG` — Sprite (полупрозрачный тёмный фон, UIOpacity ~180)
  - `TapLabel` — Label, текст "TAP TO PLAY", шрифт из assets/fonts
- Привяжи:
  - `tapToPlayPanel` → сам TapToPlayPanel
  - `tapLabel` → нода TapLabel

### GameFlowRoot → GameFlowController

| Поле | Что привязать |
|---|---|
| `tapToPlay` | TapToPlayController на TapToPlayPanel |
| `cameraRig` | CameraRig на Main Camera |
| `docCheck` | DocumentCheckUI на DocumentCard |
| `moneyCounter` | MoneyCounter на MoneyCounter_root |
| `endCard` | EndCardController на EndCard |
| `persistentUI` | PersistentUI на PersistentUI |
| `carDrive` | CarDriveController на banditcar |
| `officerArm` | OfficerArmController на офицере |
| `driverHead` | DriverHeadController на Bandit |
| `officerKnock` | OfficerKnockController на офицере |
| `arrestedPose` | ArrestedPoseController на GameFlowRoot |
| `subtitle` | Label нода Subtitle |
| `redFlash` | нода RedFlash |
| `fadeToBlack` | нода FadeToBlack |
| `officerFlashlight` | OfficerFlashlight |
| **Аудио** | |
| `audioMidnight` | Vimori - Midnight.wav |
| `audioCarStop` | car stop.mp3 |
| `audioGoodEvening` | good evening.mp3 |
| `audioOutro` | outro.mp3 |

### CarDriveController на banditcar

Если у banditcar нет отдельных задних колёс (один цилиндр):

| Поле | Что делать |
|---|---|
| `wheelFL` / `wheelFR` | Переднее левое/правое колесо (нода из FBX) |
| `wheelRL` / `wheelRR` | Оставить пустым если нет отдельных задних |
| `wheelRearSingle` | Единый задний цилиндр/ось (перетащи ноду) |
| `driveDistance` | 7 |
| `driveDuration` | 3.5 |
| `driveAxis` | 2 (Z) |
| `driveSign` | -1 |
| `wheelRadius` | 0.32 |

Если имя заднего цилиндра нестандартное — перетащи его вручную в `wheelRearSingle`.

### DocumentCard → DocumentCheckUI

Иерархия (пример):
```
DocumentCard
  ├── Плашка          (Sprite: плашкафинал.png)  ← привяжи в cardPlaque
  ├── Field_Name
  │     └── CheckBtn  (Sprite: checkbutton.png)
  ├── Field_DOB
  │     └── CheckBtn
  ├── Field_Issue
  │     └── CheckBtn
  ├── Field_Reg
  │     └── CheckBtn
  ├── Field_Expire    ← ПОСЛЕДНЕЕ = ERROR
  │     └── CheckBtn
  ├── FingerHint      (Sprite: hand.png)
  ├── ScanBarBG
  │     └── ScanBarFill  (Sprite: progressbarillusion.png)
  └── WantedStamp     (Sprite: wanted.png, scale=0)
```

В Inspector на DocumentCheckUI:
| Поле | Привязать |
|---|---|
| `fields` | Field_Name, Field_DOB, Field_Issue, Field_Reg, Field_Expire |
| `fingerHint` | FingerHint |
| `scanBarFill` | ScanBarFill |
| `cardPlaque` | Плашка |
| `sfCheckBtn` | checkbutton.png SpriteFrame |
| `sfInProgress` | in progress.png SpriteFrame |
| `sfInProgress2` | in progress2.png SpriteFrame |
| `sfCheck` | check.png SpriteFrame |
| `sfError` | error.png SpriteFrame |
| `wantedStamp` | WantedStamp |
| `redFlash` | RedFlash (из Canvas) |
| `subtitle` | Label субтитров |
| `audioSiren` | siren.wav |
| `audioArrest` | arrest.mp3 |
| `audioChecking` | checking documents.mp3 |

### PersistentUI

Всегда видны поверх сцены. В Inspector:
| Поле | Привязать |
|---|---|
| `logo` | Logo нода |
| `playNowButton` | PlayNowMini нода |

---

## Баг-фиксы

### Bug 1 — задние колёса не крутятся
Добавлено поле `wheelRearSingle` в CarDriveController.
Автопоиск по именам: `Wheel_Rear`, `wheel_back`, `Cylinder` и др.
Если не нашлось — перетащи ноду вручную в `wheelRearSingle`.

### Bug 2 — полицейский поднимает руку слишком быстро
`OfficerArmController.raiseDuration` изменён с 0.4 → **0.9 сек**.
`lowerDuration` изменён с 0.5 → **0.8 сек**.
При необходимости настрой в Inspector.

### Bug 3 — колёса крутятся после остановки
CarDriveController.update() теперь проверяет флаг `_driving`.
Колёса останавливаются **сразу** когда tween позиции завершился.

---

## Редирект в стор

`GameFlowController._redirectToStore()` — замени URL на финальный.
Поддерживает MRAID (рекламные SDK) и fallback `window.open`.

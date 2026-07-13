import {
    _decorator, Component, Node, tween, Tween, Vec3, UIOpacity,
    Label, director, Camera, AudioSource, AudioClip, DirectionalLight,
} from 'cc';
import { CameraRig } from './CameraRig';
import { DocumentCheckUI } from './DocumentCheckUI';
import { HitCarController } from './HitCarController';
import { MoneyCounter } from './MoneyCounter';
import { EndCardController } from './EndCardController';
import { PersistentUI } from './PersistentUI';
import { CarDriveController } from './CarDriveController';
import { OfficerArmController } from './OfficerArmController';
import { DriverHeadController } from './DriverHeadController';
import { OfficerKnockController } from './OfficerKnockController';
import { ArrestedPoseController } from './ArrestedPoseController';
import { BanditSwap } from './BanditSwap';
import { TapToPlayController } from './TapToPlayController';
import { HitCarUIController } from './HitCarUIController';
import { FakeLightGlow } from './FakeLightGlow';

const { ccclass, property } = _decorator;

export enum GamePhase {
    TapToPlay,
    Intro,
    DocCheck,
    Wanted,
    Arrest,
    EndCard,
}

/**
 * GameFlowController — главный режиссёр линейного playable.
 *
 * ─── Таймлайн ────────────────────────────────────────────────────────────
 *   [TapToPlay]  — экран ожидания тапа
 *   Фаза 1 (0–5s): машина едет → офицер поднимает руку (stop gesture)
 *                  → машина тормозит (car stop SFX)
 *                  → good evening audio → субтитры → голова водителя поворачивается
 *   Фаза 2 (5–18s): DocumentCheckUI — кнопки, in_progress, check/error, WANTED
 *   Фаза 3 (18–30s): swap водителя → камера отъезжает → fade → end card
 *
 * ─── Аудио ──────────────────────────────────────────────────────────────
 *   audioMidnight  — фоновая музыка (loop, играет всегда)
 *   audioCarStop   — звук торможения машины
 *   audioGoodEvening — реплика офицера при остановке
 *   audioOutro     — в фазе Arrest
 */
@ccclass('GameFlowController')
export class GameFlowController extends Component {

    // ── TapToPlay ─────────────────────────────────────────────────────────
    @property({ type: TapToPlayController, tooltip: 'TapToPlayController — экран "Tap to Play"' })
    tapToPlay: TapToPlayController | null = null;

    // ── Системные компоненты ──────────────────────────────────────────────
    @property({ type: CameraRig })
    cameraRig: CameraRig | null = null;

    @property(DocumentCheckUI)
    docCheck: DocumentCheckUI | null = null;

    @property(HitCarController)
    hitCar: HitCarController | null = null;

    @property({ type: HitCarUIController, tooltip: 'HitCarUIController — панель "Hit the Car" с рукой-подсказкой' })
    hitCarUI: HitCarUIController | null = null;

    @property(MoneyCounter)
    moneyCounter: MoneyCounter | null = null;

    @property(EndCardController)
    endCard: EndCardController | null = null;

    @property(PersistentUI)
    persistentUI: PersistentUI | null = null;

    // ── Анимационные контроллеры ──────────────────────────────────────────
    @property({ type: CarDriveController })
    carDrive: CarDriveController | null = null;

    @property({ type: OfficerArmController })
    officerArm: OfficerArmController | null = null;

    @property({ type: DriverHeadController })
    driverHead: DriverHeadController | null = null;

    @property({ type: OfficerKnockController })
    officerKnock: OfficerKnockController | null = null;

    @property({ type: ArrestedPoseController })
    arrestedPose: ArrestedPoseController | null = null;

    // ── 3D-ноды ───────────────────────────────────────────────────────────
    @property(Node)
    officer: Node | null = null;
    @property(Node)
    playerCar: Node | null = null;

    @property({ type: Node, tooltip: 'Main Camera (активна до мини-игры ареста)' })
    mainCameraNode: Node | null = null;

    @property({ type: Node, tooltip: '3D Camera — включается на время HitCar / ареста' })
    arrestCameraNode: Node | null = null;

    // ── UI-ноды ───────────────────────────────────────────────────────────
    @property(Label)
    subtitle: Label | null = null;
    @property(Node)
    wantedStamp: Node | null = null;
    @property(Node)
    redFlash: Node | null = null;
    @property(Node)
    fadeToBlack: Node | null = null;
    @property(Node)
    tapToPlayPanel: Node | null = null;

    // ── Аудио ─────────────────────────────────────────────────────────────
    @property({ type: AudioClip, tooltip: 'Vimori - Midnight.wav (фоновая музыка, loop)' })
    audioMidnight: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'car stop.mp3' })
    audioCarStop: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'good evening.mp3' })
    audioGoodEvening: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'outro.mp3' })
    audioOutro: AudioClip | null = null;

    // ── Тайминги ──────────────────────────────────────────────────────────
    @property({ tooltip: 'Сек: задержка до жеста офицера после старта' })
    officerGestureDelay: number = 1.2;

    @property({ tooltip: 'Сек: длительность езды машины' })
    driveDuration: number = 3.5;

    @property({ tooltip: 'Сек: пауза после остановки до поворота головы' })
    headTurnDelay: number = 0.6;

    @property({ tooltip: 'Сек: длительность реплики good evening (для задержки субтитра)' })
    goodEveningDuration: number = 3.5;

    @property({ tooltip: 'Сек: пауза после поворота головы до DocCheck' })
    docCheckDelay: number = 2.0;

    @property({ tooltip: 'Сек: пауза после WANTED до начала ударов' })
    knockDelay: number = 1.2;

    @property({ tooltip: 'Сек: fade to black после 4 ударов' })
    hitCarBlackoutFadeIn: number = 0.45;

    @property({ tooltip: 'Сек: fade обратно после swap' })
    hitCarBlackoutFadeOut: number = 0.6;

    @property({ tooltip: 'Сек: пауза после ударов до swap водителя' })
    swapDelay: number = 0.4;

    @property({ tooltip: 'Сек: прогресс-бар ареста' })
    arrestDuration: number = 2.0;

    @property({ tooltip: 'Итоговая сумма денег в пэкшоте' })
    rewardAmount: number = 25000;

    @property({ tooltip: 'Включить отдельную позицию камеры в фазе Arrest перед отъездом' })
    useArrestCameraPose: boolean = true;

    @property({ tooltip: 'Позиция камеры для кадра ареста (локальная у cameraNode)' })
    arrestCameraPos: Vec3 = new Vec3(1.35, 2.0, 8.3);

    @property({ tooltip: 'Поворот камеры для кадра ареста (Euler, градусы)' })
    arrestCameraRot: Vec3 = new Vec3(-8, 6, 0);

    @property({ tooltip: 'Секунд на перевод камеры в кадр ареста' })
    arrestCameraMoveTime: number = 0.45;

    // ── Частное состояние ─────────────────────────────────────────────────
    private _phase: GamePhase = GamePhase.TapToPlay;
    private _bgMusic: AudioSource | null = null;
    private _sfxSrc: AudioSource | null = null;
    private _goodEveningStartTime: number = 0;
    private _officerDetached = false;
    private _swapDone = false;

    // ─────────────────────────────────────────────────────────────────────
    onLoad(): void {
        this._phase = GamePhase.TapToPlay;

        // Аудио-источники
        this._bgMusic = this.node.addComponent(AudioSource);
        this._sfxSrc  = this.node.addComponent(AudioSource);

        // Начальные состояния UI
        if (this.subtitle)        { this.subtitle.node.active = false; }
        if (this.wantedStamp)     { this.wantedStamp.setScale(0, 0, 0); }
        if (this.redFlash)        { this._setOp(this.redFlash, 0); }
        if (this.fadeToBlack)     { this._setOp(this.fadeToBlack, 0); }
        if (this.docCheck)        { this.docCheck.node.active = false; }
        if (this.moneyCounter)    { this.moneyCounter.node.active = false; }
        if (this.endCard)         { this.endCard.node.active = false; }

        // Субтитры поверх DocumentCard (sibling order)
        this._ensureSubtitleOnTop();

        // Камеры: Main Camera активна, arrest Camera выключена
        this._resolveCameras();
        this._setArrestCameraActive(false);

        // DocCheck callback
        if (this.docCheck) {
            this.docCheck.onWanted = this._onWantedTriggered.bind(this);
        }

        // HitCar авто-резолв
        if (this.hitCar) {
            // onExitComplete и onHit задаются позже в _startHitCar()
            if (!this.carDrive) this.carDrive = this.hitCar.node.getComponent(CarDriveController);
            // Корень машины — banditcar (HitCar.node), не дочерний mesh spr_lafera1
            this.playerCar = this.hitCar.node;
        }

        // Авто-резолв контроллеров
        if (!this.driverHead && this.playerCar) {
            this.driverHead = this.playerCar.getComponent(DriverHeadController)
                ?? this._findInChildren(this.playerCar, DriverHeadController);
        }
        if (!this.officerArm)   this.officerArm   = this._findInScene(OfficerArmController);
        if (!this.officer && this.officerArm) this.officer = this.officerArm.node;
        if (!this.officerKnock) this.officerKnock = this._findInScene(OfficerKnockController);
        if (!this.arrestedPose) this.arrestedPose = this._findInScene(ArrestedPoseController);

        // Голова: крутим весь JohnHead налево (как было изначально)
        if (this.driverHead) {
            this.driverHead.lookAtAngleY = 45;
            this.driverHead.tiltAngleX = 5;
        }

        // EndCard
        if (this.endCard) {
            this.endCard.onPlayNow = this._redirectToStore.bind(this);
        }
        if (this.persistentUI) {
            this.persistentUI.onPlayNow = this._redirectToStore.bind(this);
        }

        // TapToPlay
        if (this.tapToPlay) {
            this.tapToPlay.onStartGame = this._onGameStart.bind(this);
        }
    }

    start(): void {
        if (this.cameraRig) this.cameraRig.applyOrientation(false);

        // PointLight → дешёвый fake-glow (без realtime lighting)
        FakeLightGlow.replacePointLightsInScene();

        // Фоновая музыка стартует сразу (на экране tap to play)
        if (this._bgMusic && this.audioMidnight) {
            this._bgMusic.clip  = this.audioMidnight;
            this._bgMusic.loop  = true;
            this._bgMusic.volume = 0.6;
            this._bgMusic.play();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TAP TO PLAY
    // ═══════════════════════════════════════════════════════════════════════

    /** Вызывается TapToPlayController когда игрок тапнул. */
    private _onGameStart(): void {
        this.scheduleOnce(() => this._runIntro(), 0.1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ФАЗА 1 — INTRO
    // ═══════════════════════════════════════════════════════════════════════
    private _runIntro(): void {
        this._phase = GamePhase.Intro;

        // Тени + лишние light updates дают просадку FPS на езде машины
        this._disableRealtimeShadows();

        // Полицейский не должен ехать вместе с машиной — отцепляем до startDrive()
        this._detachOfficerFromCar();

        // Машина едет (субтитры запускаются только после остановки в _onCarStopped)
        if (this.carDrive) {
            this.carDrive.driveDuration = this.driveDuration;
            this.carDrive.onStopped = this._onCarStopped.bind(this);
            this.carDrive.startDrive();
        } else {
            this.scheduleOnce(() => this._onCarStopped(), this.driveDuration);
        }

        // Офицер поднимает руку (жест стоп)
        this.scheduleOnce(() => {
            if (this.officerArm) {
                this.officerArm.playStopGesture();
            }
        }, this.officerGestureDelay);
    }

    private _onCarStopped(): void {
        // Звук торможения
        this._playSfx(this.audioCarStop);

        // Субтитр 1 — сразу после остановки
        this._showSubtitle('Good evening. Do you know how fast you were going?', 4.0);

        // Good evening audio — чуть после субтитра
        this.scheduleOnce(() => {
            this._playSfx(this.audioGoodEvening);
            this._goodEveningStartTime = Date.now() / 1000;
        }, 0.1);

        // Через headTurnDelay — голова водителя
        this.scheduleOnce(() => {
            if (this.driverHead) {
                this.driverHead.onTurnComplete = this._onHeadTurned.bind(this);
                this.driverHead.turnToOfficer();
            } else {
                this._onHeadTurned();
            }
        }, this.headTurnDelay);
    }

    private _onHeadTurned(): void {
        // Субтитр 2 — после окончания аудио good evening, но с уменьшенной паузой
        const now = Date.now() / 1000;
        const elapsed = this._goodEveningStartTime > 0 ? (now - this._goodEveningStartTime) : 0;
        // Уменьшаем паузу: субтитр 2 появляется через 0.3s после конца аудио (вместо waiting for full duration)
        const remaining = Math.max(0, this.goodEveningDuration - elapsed - 0.5);
        this.scheduleOnce(() => {
            this._showSubtitle('License and registration please.', 3.0);
        }, remaining);

        // DocCheck входит только после субтитра "License and registration" (remaining + 3.0s + 0.5s пауза)
        const docDelay = remaining + 3.0 + 0.5;
        this.scheduleOnce(() => this._enterDocCheck(), docDelay);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ФАЗА 2 — DOC CHECK
    // ═══════════════════════════════════════════════════════════════════════
    private _enterDocCheck(): void {
        this._phase = GamePhase.DocCheck;
        if (this.docCheck) {
            // Передаём subtitle если не привязан напрямую в DocumentCheckUI
            if (!this.docCheck.subtitle && this.subtitle) {
                this.docCheck.subtitle = this.subtitle;
            }
            // Анимированное появление DocumentCard снизу
            const card = this.docCheck.node;
            card.active = true;
            const origPos = card.position.clone();
            card.setPosition(origPos.x, origPos.y - 200, origPos.z);
            this._setOp(card, 0);
            tween(card)
                .to(0.45, { position: origPos }, { easing: 'backOut' })
                .start();
            this._fadeNode(card, 255, 0.35);
            // Начать логику через 0.45s — когда анимация появления завершится
            this.scheduleOnce(() => {
                if (this.docCheck) this.docCheck.begin();
            }, 0.45);
        }
    }

    /** Когда DocumentCheckUI добрался до ERROR → WANTED */
    private _onWantedTriggered(): void {
        this._phase = GamePhase.Wanted;

        // Скрыть DocumentCard (документы, штамп, кнопки) с задержкой и плавным fade.
        // Звук ареста уже на Canvas — active=false карточки его не убивает.
        if (this.docCheck) {
            this.scheduleOnce(() => {
                this._fadeNode(this.docCheck!.node, 0, 0.4, () => {
                    if (this.docCheck) this.docCheck.node.active = false;
                });
            }, 0.6);
        }

        // Через небольшую паузу → запускаем мини-игру "бей по машине"
        this.scheduleOnce(() => this._startHitCar(), this.knockDelay);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // МИНИ-ИГРА — HIT CAR
    // ═══════════════════════════════════════════════════════════════════════
    private _startHitCar(): void {
        // Красная виньетка WANTED перебивает rim-подсветку машины
        if (this.docCheck) this.docCheck.stopVignette();
        if (this.redFlash) this._setOp(this.redFlash, 0);

        // Переключаемся с Main Camera на 3D Camera для мини-игры
        this._setArrestCameraActive(true);

        if (this.hitCar) {
            // Тряска/зум — на активной 3D Camera (не на Main Camera)
            const camNode = this.arrestCameraNode
                ?? this.cameraRig?.cameraNode
                ?? this._findCameraNode();
            if (camNode) this.hitCar.cameraNode = camNode;
            // Не двигаем заранее поставленную Camera — только тряска при ударах
            this.hitCar.zoomCameraOnBegin = !this.arrestCameraNode;

            // Первый тап — спрятать руку/лейбл, HP-бар остаётся
            this.hitCar.onFirstHit = () => {
                if (this.hitCarUI) this.hitCarUI.hideHint();
            };

            this.hitCar.onProgress = (cur, total) => {
                if (this.hitCarUI) this.hitCarUI.setProgress(cur, total);
            };

            this.hitCar.onImpact = () => {
                if (this.hitCarUI) {
                    this.hitCarUI.shakeBar();
                    this.hitCarUI.pulseHitVignette();
                }
            };

            // Тап → замах офицера; тряска — в момент strike (onKnock)
            if (this.officerKnock) {
                this.officerKnock.onKnock = () => {
                    if (this.hitCar) this.hitCar.playHitImpact();
                };
            }
            this.hitCar.onHit = () => this._playOfficerSingleHit();
            this.hitCar.onExitComplete = this._onBanditExited.bind(this);

            if (this.hitCarUI) {
                this.hitCarUI.show();
            }

            this.hitCar.begin();
        } else {
            this.scheduleOnce(() => this._onBanditExited(), 1.5);
        }
    }

    /** Одиночный удар офицера в дверь (вызывается при каждом тапе игрока). */
    private _playOfficerSingleHit(): void {
        if (!this.officerKnock) {
            // Нет анимации руки — impact сразу
            if (this.hitCar) this.hitCar.playHitImpact();
            return;
        }
        this.officerKnock.singleKnock();
    }

    /** Вызывается после 4 ударов по машине. */
    private _onBanditExited(): void {
        if (this.hitCarUI) this.hitCarUI.hide();

        // Вернуть копа в стойку — Punching не должна «залипать»
        if (this.officerKnock) this.officerKnock.resetPose();

        if (this.docCheck) this.docCheck.node.active = false;
        if (this.wantedStamp) this.wantedStamp.active = false;
        if (this.docCheck) this.docCheck.stopSiren();

        this._runHitCarBlackout();
    }

    /** Fade to black → swap под чёрным экраном → fade обратно → арест. */
    private _runHitCarBlackout(): void {
        if (!this.fadeToBlack) {
            if (!this._performSwapDuringBlackout()) return;
            this._onSwapComplete();
            return;
        }

        this.fadeToBlack.active = true;
        this._setOp(this.fadeToBlack, 0);
        this._fadeNode(this.fadeToBlack, 255, this.hitCarBlackoutFadeIn, () => {
            if (!this._performSwapDuringBlackout()) return;
            this._fadeNode(this.fadeToBlack, 0, this.hitCarBlackoutFadeOut, () => {
                this._onSwapComplete();
            });
        });
    }

    /** Swap водителя и кадр ареста — только пока экран чёрный. */
    private _performSwapDuringBlackout(): boolean {
        const swapped = this._swapBanditCharacters();
        this._snapCameraToArrestPose();
        return swapped;
    }

    /**
     * Единственный путь swap: скрыть banditcar/Bandit, показать Characters/Bandit-arrested.
     * @returns true если swap выполнен
     */
    private _swapBanditCharacters(): boolean {
        if (this._swapDone) return true;

        const pose = this.arrestedPose;
        const car = this.hitCar?.node ?? this.carDrive?.node ?? this.playerCar ?? null;

        const driverRef = pose?.originalDriver ?? this.hitCar?.driver ?? null;
        const arrested = BanditSwap.resolveArrested(
            pose?.charactersRoot ?? null,
            pose?.arrestedDriver ?? null,
        );
        const drivers = BanditSwap.collectDriversToHide(car, driverRef);

        if (!arrested) {
            console.error(
                '[GameFlow] swap failed — arrested node not found. car:',
                car?.name ?? '(none)',
                'pose:',
                pose ? 'ok' : '(missing)',
            );
            return false;
        }

        if (drivers.length === 0) {
            console.warn('[GameFlow] no driver refs — hiding every Bandit in scene');
            BanditSwap.hideEveryBanditInScene(arrested);
        }

        const pos = pose?.useSpawnPosition ? pose.criminalSpawnPos : undefined;
        if (drivers.length > 0) {
            BanditSwap.performSwap(car, arrested, pos, driverRef);
        } else {
            BanditSwap.showArrested(arrested, pos);
        }
        if (this.hitCar) this.hitCar.lockDriverHidden();
        this._swapDone = true;
        return true;
    }
    /** Выключает realtime-тени — при движении машины CSM/shadow map дают сильный FPS drop. */
    private _disableRealtimeShadows(): void {
        const scene = director.getScene();
        if (!scene) return;
        const lights = scene.getComponentsInChildren(DirectionalLight);
        for (const light of lights) {
            light.shadowEnabled = false;
        }
        // SceneGlobals.shadows — через internals, если доступно
        try {
            const globals = (scene as any).globals;
            if (globals?.shadows) globals.shadows.enabled = false;
        } catch (_) { /* ignore */ }
    }

    /**
     * ManPolice_skin1 в сцене — ребёнок banditcar/Characters.
     * Перед ездой переносим на Vehicles, сохраняя мировую позицию.
     */
    private _detachOfficerFromCar(): void {
        if (this._officerDetached) return;

        const officer = this.officer ?? this.officerArm?.node ?? this.officerKnock?.node;
        if (!officer?.isValid) return;

        const car = this.carDrive?.node ?? this.hitCar?.node ?? this.playerCar;
        if (!car?.isValid || !officer.isChildOf(car)) return;

        const anchor = car.parent ?? director.getScene() as unknown as Node;
        if (!anchor?.isValid) return;

        const worldPos = officer.getWorldPosition();
        const worldRot = officer.getWorldRotation();
        officer.setParent(anchor, true);
        officer.setWorldPosition(worldPos);
        officer.setWorldRotation(worldRot);

        this._officerDetached = true;
    }

    private _snapCameraToArrestPose(): void {
        if (!this.useArrestCameraPose) return;
        const camNode = this._activeCamNode();
        if (!camNode) return;
        camNode.setPosition(
            this.arrestCameraPos.x,
            this.arrestCameraPos.y,
            this.arrestCameraPos.z,
        );
        camNode.setRotationFromEuler(
            this.arrestCameraRot.x,
            this.arrestCameraRot.y,
            this.arrestCameraRot.z,
        );
    }

    private _onSwapComplete(): void {
        this._phase = GamePhase.Arrest;

        // Ещё раз сбросить Punching — иначе на packshot коп «залипает» в замахе
        if (this.officerKnock) this.officerKnock.resetPose();

        this._showSubtitle("Let's keep it simple.", 2.5);
        this._playSfx(this.audioOutro);

        this.scheduleOnce(() => this._cameraZoomOut(), 0.8);

        this.scheduleOnce(() => this._onDriverExited(), this.arrestDuration + 0.5);
    }

    private _onDriverExited(): void {
        if (this.moneyCounter) {
            this.moneyCounter.node.active = true;
            this.moneyCounter.play(this.rewardAmount);
        }
        this.scheduleOnce(() => this._runEndCard(), this.arrestDuration + 1.5);
    }

    private _runEndCard(): void {
        this._phase = GamePhase.EndCard;
        if (this.persistentUI) this.persistentUI.hide();

        // Fade to black — медленнее (1.5s)
        const fadeDuration = 1.5;
        if (this.fadeToBlack) {
            this._setOp(this.fadeToBlack, 0);
            this._fadeNode(this.fadeToBlack, 255, fadeDuration);
        }

        // EndCard появляется после завершения fade
        this.scheduleOnce(() => {
            if (this.moneyCounter) this.moneyCounter.node.active = false;
            if (this.endCard) {
                this.endCard.node.active = true;
                this.endCard.show();
            }
        }, fadeDuration);
    }

    // ── Камеры ────────────────────────────────────────────────────────────
    private _resolveCameras(): void {
        if (!this.mainCameraNode) {
            this.mainCameraNode = this.cameraRig?.cameraNode ?? null;
        }
        if (!this.arrestCameraNode) {
            const scene = director.getScene();
            if (scene) {
                // Сначала среди прямых детей сцены (Main Camera / Camera)
                for (const child of scene.children) {
                    if (child.name === 'Camera') {
                        this.arrestCameraNode = child;
                        break;
                    }
                }
                if (!this.arrestCameraNode) {
                    this.arrestCameraNode = this._findNodeByName(scene, 'Camera');
                }
            }
        }
        if (this.arrestCameraNode && !this.arrestCameraNode.active && this.mainCameraNode) {
            this.mainCameraNode.active = true;
        }
    }

    /** true = 3D Camera, false = Main Camera */
    private _setArrestCameraActive(useArrestCam: boolean): void {
        this._resolveCameras();
        if (this.arrestCameraNode) {
            this.arrestCameraNode.active = useArrestCam;
        }
        if (this.mainCameraNode) {
            this.mainCameraNode.active = !useArrestCam;
        }
    }

    private _activeCamNode(): Node | null {
        if (this.arrestCameraNode?.active) return this.arrestCameraNode;
        return this.mainCameraNode ?? this.cameraRig?.cameraNode ?? this._findCameraNode();
    }

    // ── Zoom out камеры для пэкшота ────────────────────────────────────────
    private _cameraZoomOut(): void {
        // Гарантия: перед отъездом камеры — спокойная стойка, не Punching
        if (this.officerKnock) this.officerKnock.resetPose();

        const camNode = this._activeCamNode();
        if (!camNode) return;

        Tween.stopAllByTarget(camNode);
        const startPos = camNode.position.clone();
        const endPos = new Vec3(startPos.x, startPos.y + 1.0, startPos.z + 3.5);

        tween(camNode)
            .to(3.0, { position: endPos }, { easing: 'sineInOut' })
            .start();
    }

    private _moveCameraToArrestPose(): number {
        if (!this.useArrestCameraPose) return 0;
        const camNode = this._activeCamNode();
        if (!camNode) return 0;

        tween(camNode)
            .to(this.arrestCameraMoveTime, {
                position: new Vec3(this.arrestCameraPos.x, this.arrestCameraPos.y, this.arrestCameraPos.z),
                eulerAngles: new Vec3(this.arrestCameraRot.x, this.arrestCameraRot.y, this.arrestCameraRot.z),
            }, { easing: 'sineInOut' })
            .start();

        return this.arrestCameraMoveTime;
    }

    private _findCameraNode(): Node | null {
        const scene = director.getScene();
        if (!scene) return null;
        const cam = this._findInChildren(scene, Camera);
        return cam ? cam.node : null;
    }

    private _findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this._findNodeByName(child, name);
            if (found) return found;
        }
        return null;
    }

    /** Поднимает Subtitle выше DocumentCard в sibling-порядке Canvas. */
    private _ensureSubtitleOnTop(): void {
        if (!this.subtitle) return;
        const subNode = this.subtitle.node;
        const parent = subNode.parent;
        if (!parent) return;

        // Ставим субтитры последним ребёнком → рисуются поверх
        subNode.setSiblingIndex(parent.children.length - 1);

        // Если DocumentCard рядом — убедимся что subtitle после него
        if (this.docCheck) {
            const docIdx = this.docCheck.node.getSiblingIndex();
            const subIdx = subNode.getSiblingIndex();
            if (subIdx <= docIdx) {
                subNode.setSiblingIndex(docIdx + 1);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Утилиты
    // ═══════════════════════════════════════════════════════════════════════

    private _showSubtitle(text: string, visibleDuration: number): void {
        if (!this.subtitle) return;
        const lbl = this.subtitle;
        // Поверх DocumentCard
        const parent = lbl.node.parent;
        if (parent) lbl.node.setSiblingIndex(parent.children.length - 1);
        lbl.string = text;
        lbl.node.active = true;
        this._setOp(lbl.node, 0);
        let op = lbl.node.getComponent(UIOpacity);
        if (!op) op = lbl.node.addComponent(UIOpacity);
        tween(op)
            .to(0.35, { opacity: 255 })
            .delay(visibleDuration)
            .to(0.4, { opacity: 0 })
            .call(() => { lbl.node.active = false; })
            .start();
    }

    private _playSfx(clip: AudioClip | null): void {
        if (!clip || !this._sfxSrc) return;
        this._sfxSrc.playOneShot(clip, 1.0);
    }

    private _setOp(node: Node | null, a: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    private _fadeNode(node: Node | null, to: number, time: number, onDone?: () => void): void {
        if (!node) { onDone && onDone(); return; }
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        tween(op)
            .to(time, { opacity: to })
            .call(() => { onDone && onDone(); })
            .start();
    }

    private _findInChildren<T extends Component>(root: Node, type: new () => T): T | null {
        let found: T | null = null;
        const visit = (n: Node): boolean => {
            const c = n.getComponent(type);
            if (c) { found = c; return true; }
            for (const child of n.children) { if (visit(child)) return true; }
            return false;
        };
        visit(root);
        return found;
    }

    private _findInScene<T extends Component>(type: new () => T): T | null {
        const scene = director.getScene();
        if (!scene) return null;
        return this._findInChildren(scene as unknown as Node, type);
    }

    private _redirectToStore(): void {
        const url = 'https://play.google.com/store/apps/details?id=com.onestate.game';
        try {
            const w = window as any;
            if (typeof w.mraid !== 'undefined' && w.mraid.open) { w.mraid.open(url); return; }
        } catch (_) { }
        try { window.open(url, '_blank'); } catch (_) { (window as any).location.href = url; }
    }
}

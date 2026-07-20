import {
    _decorator, Component, Node, tween, Tween, Vec3, UIOpacity, Color,
    Label, UITransform, Widget, view, director, Camera, AudioSource, AudioClip,
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
import { SirenFlasher } from './SirenFlasher';
import { FakeLightGlow } from './FakeLightGlow';
import { RoadTilingFix } from './RoadTilingFix';
import { DrivePerfFix } from './DrivePerfFix';
import { PortraitPerf } from './PortraitPerf';
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

    @property({ type: SirenFlasher, tooltip: 'Мигание сирен полицейской машины (WANTED)' })
    sirenFlasher: SirenFlasher | null = null;

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
    private _prepDone = false;
    private _warmupRunning = false;
    private _loadingNode: Node | null = null;

    // ─────────────────────────────────────────────────────────────────────
    onLoad(): void {
        this._phase = GamePhase.TapToPlay;

        // Portrait: soft shadingScale + выкл пустой PostProcess + лишние SpotLight
        PortraitPerf.apply();
        view.on('canvas-resize', this._onPortraitPerfResize, this);

        this._bgMusic = this.node.addComponent(AudioSource);
        this._sfxSrc  = this.node.addComponent(AudioSource);

        if (this.subtitle)        { this.subtitle.node.active = false; }
        // radiomessage (баббл) скрыт до первого сообщения
        const bubble = this.subtitle?.node.parent;
        if (bubble && bubble.name.toLowerCase().includes('radio')) {
            bubble.active = false;
            this._setOp(bubble, 0);
        }
        if (this.wantedStamp)     { this.wantedStamp.setScale(0, 0, 0); }
        if (this.redFlash)        { this._setOp(this.redFlash, 0); }
        if (this.fadeToBlack)     { this._setOp(this.fadeToBlack, 0); }
        if (this.docCheck)        { this.docCheck.node.active = false; }
        if (this.moneyCounter)    { this.moneyCounter.node.active = false; }
        if (this.endCard)         { this.endCard.node.active = false; }

        this._styleSubtitle();
        this._ensureSubtitleOnTop();

        this._resolveCameras();
        this._setArrestCameraActive(false);

        if (this.docCheck) {
            this.docCheck.onWanted = this._onWantedTriggered.bind(this);
        }

        if (this.hitCar) {
            if (!this.carDrive) this.carDrive = this.hitCar.node.getComponent(CarDriveController);
            this.playerCar = this.hitCar.node;
        }

        if (!this.driverHead && this.playerCar) {
            this.driverHead = this.playerCar.getComponent(DriverHeadController)
                ?? this._findInChildren(this.playerCar, DriverHeadController);
        }
        if (!this.officerArm)   this.officerArm   = this._findInScene(OfficerArmController);
        if (!this.officer && this.officerArm) this.officer = this.officerArm.node;
        if (!this.officerKnock) this.officerKnock = this._findInScene(OfficerKnockController);
        if (!this.arrestedPose) this.arrestedPose = this._findInScene(ArrestedPoseController);
        if (!this.sirenFlasher) this.sirenFlasher = this._findInScene(SirenFlasher);

        if (this.driverHead) {
            this.driverHead.lookAtAngleY = 45;
            this.driverHead.tiltAngleX = 5;
        }

        if (this.endCard) {
            this.endCard.onPlayNow = this._redirectToStore.bind(this);
        }
        if (this.persistentUI) {
            this.persistentUI.onPlayNow = this._redirectToStore.bind(this);
        }

        if (this.tapToPlay) {
            this.tapToPlay.onStartGame = this._onGameStart.bind(this);
            this.tapToPlay.setReady(false);
        }

        this._prepForDrive();
    }

    private _onPortraitPerfResize = (): void => {
        PortraitPerf.apply();
    };

    start(): void {
        if (this.cameraRig) this.cameraRig.applyOrientation(false);

        if (this._bgMusic && this.audioMidnight) {
            this._bgMusic.clip  = this.audioMidnight;
            this._bgMusic.loop  = true;
            this._bgMusic.volume = 0.6;
            this._bgMusic.play();
        }

        if (!this.officerKnock) this.officerKnock = this._findInScene(OfficerKnockController);
        if (this.officerKnock) void this.officerKnock.preload();
        if (this.officerArm) {
            void this.officerArm.preload().then(() => this.officerArm?.holdStartFrame());
        }

        // Пока висит Tap to Play — греем машину/шейдеры по кадрам
        this._startTapWarmup();
    }

    onDestroy(): void {
        view.off('canvas-resize', this._onPortraitPerfResize, this);
    }

    /** Прогрев под чёрным экраном + Loading... */
    private _startTapWarmup(): void {
        if (this._warmupRunning) return;
        this._warmupRunning = true;
        if (this.tapToPlay) this.tapToPlay.setReady(false);
        this._setWarmupBlackCover(true);
        this.schedule(this._onTapWarmupTick, 0);
    }

    private _onTapWarmupTick(): void {
        if (this._phase !== GamePhase.TapToPlay) {
            this._stopTapWarmup();
            return;
        }
        const car = this.carDrive?.node ?? this.hitCar?.node ?? this.playerCar;
        const cam = this.mainCameraNode
            ?? this.cameraRig?.cameraNode
            ?? this._findCameraNode();
        const cont = DrivePerfFix.warmUpTick(car, cam);
        this._setWarmupBlackCover(DrivePerfFix.isFrustumCoverActive());
        if (!cont) {
            this._stopTapWarmup();
        }
    }

    private _stopTapWarmup(): void {
        if (!this._warmupRunning) return;
        this._warmupRunning = false;
        this.unschedule(this._onTapWarmupTick);
        this._setWarmupBlackCover(false);
        if (this.tapToPlay && this._phase === GamePhase.TapToPlay) {
            if (this.officerArm) this.officerArm.holdStartFrame();
            this.tapToPlay.setReady(true);
        }
    }

    /** Чёрный поверх всего (включая Tap to Play) + мигающий Loading... */
    private _setWarmupBlackCover(on: boolean): void {
        const fade = this.fadeToBlack;
        if (!fade?.isValid) return;

        if (on) {
            fade.active = true;
            this._setOp(fade, 255);
            // Поверх всего UI, включая Tap to Play
            if (fade.parent) {
                fade.setSiblingIndex(fade.parent.children.length - 1);
            }
            this._ensureLoadingLabel(fade);
            this._syncLoadingToTapLabel();
            return;
        }

        this._hideLoadingLabel();
        if (this._phase === GamePhase.TapToPlay) {
            this._setOp(fade, 0);
            fade.active = false;
        }
    }

    private _ensureLoadingLabel(fade: Node): void {
        if (this._loadingNode?.isValid) {
            this._loadingNode.active = true;
            this._syncLoadingToTapLabel();
            if (this._loadingNode.parent) {
                this._loadingNode.setSiblingIndex(this._loadingNode.parent.children.length - 1);
            }
            return;
        }

        const src = this.tapToPlay?.tapLabel ?? null;
        const parent = fade.parent ?? fade;
        const n = new Node('WarmupLoading');
        n.layer = fade.layer;
        parent.addChild(n);
        n.setSiblingIndex(parent.children.length - 1);

        const uit = n.addComponent(UITransform);
        if (src) {
            const srcUt = src.node.getComponent(UITransform);
            if (srcUt) {
                uit.setContentSize(srcUt.contentSize);
                uit.setAnchorPoint(srcUt.anchorPoint);
            } else {
                uit.setContentSize(320, 50);
                uit.setAnchorPoint(0.5, 0.5);
            }
        } else {
            uit.setContentSize(320, 50);
            uit.setAnchorPoint(0.5, 0.5);
        }

        const lbl = n.addComponent(Label);
        lbl.string = 'LOADING...';
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign = Label.VerticalAlign.CENTER;
        lbl.overflow = Label.Overflow.NONE;
        lbl.color = new Color(255, 255, 255, 255);

        if (src) {
            lbl.fontSize = src.fontSize;
            lbl.lineHeight = src.lineHeight;
            lbl.color = src.color.clone();
            lbl.isBold = src.isBold;
            lbl.isItalic = src.isItalic;
            lbl.enableOutline = src.enableOutline;
            if (src.font) {
                lbl.useSystemFont = false;
                lbl.font = src.font;
            } else {
                lbl.useSystemFont = src.useSystemFont;
                lbl.fontFamily = src.fontFamily;
            }
        } else {
            lbl.fontSize = 40;
            lbl.lineHeight = 40;
            lbl.useSystemFont = false;
        }

        this._loadingNode = n;
        this._syncLoadingToTapLabel();

        // То же мигание, что у Tap to Play (0.7s, 255 ↔ 80)
        const op = n.addComponent(UIOpacity);
        op.opacity = 255;
        tween(op)
            .repeatForever(
                tween(op)
                    .to(0.7, { opacity: 255 }, { easing: 'sineOut' })
                    .to(0.7, { opacity: 80 }, { easing: 'sineIn' }),
            )
            .start();
    }

    /** Позиция/скейл 1:1 с лейблом TAP TO PLAY. */
    private _syncLoadingToTapLabel(): void {
        const n = this._loadingNode;
        const src = this.tapToPlay?.tapLabel?.node;
        if (!n?.isValid || !src?.isValid) return;
        n.setWorldPosition(src.worldPosition);
        n.setWorldScale(src.worldScale);
        n.setWorldRotation(src.worldRotation);
    }

    private _hideLoadingLabel(): void {
        if (!this._loadingNode?.isValid) {
            this._loadingNode = null;
            return;
        }
        Tween.stopAllByTarget(this._loadingNode.getComponent(UIOpacity) ?? this._loadingNode);
        this._loadingNode.destroy();
        this._loadingNode = null;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TAP TO PLAY
    // ═══════════════════════════════════════════════════════════════════════

    private _onGameStart(): void {
        this.scheduleOnce(() => this._runIntro(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ФАЗА 1 — INTRO
    // ═══════════════════════════════════════════════════════════════════════
    private _runIntro(): void {
        this._phase = GamePhase.Intro;
        this._stopTapWarmup();

        // Не даём CameraRig сбрасывать позу при landscape
        if (this.cameraRig) this.cameraRig.lockPose();

        const car = this.carDrive?.node ?? this.hitCar?.node ?? this.playerCar;
        DrivePerfFix.finishWarmup(car);
        this._setWarmupBlackCover(false);

        this._prepForDrive();
        DrivePerfFix.beginDrive();
        if (this.officerArm) this.officerArm.holdStartFrame();

        if (this.carDrive) {
            this.carDrive.spinWheels = true;
            this.carDrive.driveDuration = this.driveDuration;
            this.carDrive.onStopped = this._onCarStopped.bind(this);
            this.carDrive.startDrive();
        } else {
            this.scheduleOnce(() => this._onCarStopped(), this.driveDuration);
        }

        this.scheduleOnce(() => {
            if (this.officerArm) this.officerArm.playStopGesture();
        }, this.officerGestureDelay);
    }

    private _onCarStopped(): void {
        DrivePerfFix.endDrive();

        this._playSfx(this.audioCarStop);
        this._showSubtitle('Good evening. Do you know how fast you were going?', 4.0);

        this.scheduleOnce(() => {
            this._playSfx(this.audioGoodEvening);
            this._goodEveningStartTime = Date.now() / 1000;
        }, 0.1);

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
            // Красные SpotLight в portrait включаем вместе с картой
            PortraitPerf.setDocumentCardVisible(true);
            // Начать логику через 0.45s — когда анимация появления завершится
            this.scheduleOnce(() => {
                if (this.docCheck) this.docCheck.begin();
            }, 0.45);
        }
    }

    /** Когда DocumentCheckUI добрался до ERROR → WANTED */
    private _onWantedTriggered(): void {
        this._phase = GamePhase.Wanted;

        if (!this.sirenFlasher) this.sirenFlasher = this._findInScene(SirenFlasher);
        if (!this.sirenFlasher) {
            const host = this.node;
            this.sirenFlasher = host.getComponent(SirenFlasher) ?? host.addComponent(SirenFlasher);
        }
        this.sirenFlasher.startFlashing();
        // Portrait: красные SpotLight с WANTED до конца игры
        PortraitPerf.setWantedOrArrestActive(true);

        if (this.docCheck) {
            this.scheduleOnce(() => {
                this._fadeNode(this.docCheck!.node, 0, 0.35, () => {
                    if (this.docCheck) this.docCheck.node.active = false;
                    PortraitPerf.setDocumentCardVisible(false);
                });
            }, 0.35);
        }

        // Быстрый плавный переход в мини-игру ударов
        this.scheduleOnce(() => this._transitionToHitCar(), Math.min(0.55, this.knockDelay));
    }

    /** Fade → смена камеры → fade out → hit UI. */
    private _transitionToHitCar(): void {
        const fadeIn = 0.28;
        const fadeOut = 0.35;

        const startMini = () => {
            this._startHitCar();
            if (this.fadeToBlack) {
                this._fadeNode(this.fadeToBlack, 0, fadeOut, () => {
                    if (this.fadeToBlack) this.fadeToBlack.active = false;
                });
            }
        };

        if (!this.fadeToBlack) {
            startMini();
            return;
        }

        this.fadeToBlack.active = true;
        this._bringFadeOnTop();
        this._setOp(this.fadeToBlack, 0);
        this._fadeNode(this.fadeToBlack, 255, fadeIn, () => {
            // Под чёрным — уже камера ареста + begin
            this._setArrestCameraActive(true);
            startMini();
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // МИНИ-ИГРА — HIT CAR
    // ═══════════════════════════════════════════════════════════════════════
    private _startHitCar(): void {
        if (this.docCheck) this.docCheck.stopVignette();
        if (this.redFlash) this._setOp(this.redFlash, 0);

        // Камера уже могла быть переключена в _transitionToHitCar
        this._setArrestCameraActive(true);

        if (this.hitCar) {
            const camNode = this.arrestCameraNode
                ?? this.cameraRig?.cameraNode
                ?? this._findCameraNode();
            if (camNode) this.hitCar.cameraNode = camNode;
            this.hitCar.zoomCameraOnBegin = !this.arrestCameraNode;

            this.hitCar.onFirstHit = () => {
                if (this.hitCarUI) {
                    this.hitCarUI.hideHint();
                    this.hitCarUI.showHpBar();
                }
            };

            // HP только в момент касания кулаком (onImpact), не на замахе
            this.hitCar.onProgress = null;

            this.hitCar.onImpact = (strikeIndex, _isLast) => {
                if (this.hitCarUI) {
                    this.hitCarUI.setProgress(strikeIndex, this.hitCar!.tapsRequired);
                    this.hitCarUI.shakeBar();
                    this.hitCarUI.pulseHitVignette();
                }
            };

            if (this.officerKnock) {
                this.officerKnock.onKnock = () => {
                    if (this.hitCar) this.hitCar.playHitImpact();
                };
            }
            this.hitCar.onHit = (_hitIndex) => {
                // Не фризим на impact: иначе 4-й удар «обрывается», а follow-through нужен до fade
                this._playOfficerSingleHit(false);
            };
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
    private _playOfficerSingleHit(freezeAtImpact: boolean = false): void {
        if (!this.officerKnock) {
            // Нет анимации руки — impact сразу
            if (this.hitCar) this.hitCar.playHitImpact();
            return;
        }
        this.officerKnock.singleKnock(freezeAtImpact);
    }

    /** Вызывается после 4 ударов по машине. */
    private _onBanditExited(): void {
        if (this.hitCarUI) this.hitCarUI.hide();

        // Punching НЕ сбрасываем здесь — поза держится до начала затемнения

        if (this.docCheck) this.docCheck.node.active = false;
        PortraitPerf.setDocumentCardVisible(false);
        if (this.wantedStamp) this.wantedStamp.active = false;
        // Сирену (мигалки) не гасим — крутятся до конца playable
        // audio siren можно остановить, визуал оставить
        if (this.docCheck) this.docCheck.stopSiren();

        this._runHitCarBlackout();
    }

    /** Fade to black → swap под чёрным экраном → fade обратно → арест. */
    private _runHitCarBlackout(): void {
        if (!this.fadeToBlack) {
            if (this.officerKnock) this.officerKnock.resetPose();
            if (!this._performSwapDuringBlackout()) return;
            this._onSwapComplete();
            return;
        }

        this.fadeToBlack.active = true;
        this._setOp(this.fadeToBlack, 0);
        this._fadeNode(this.fadeToBlack, 255, this.hitCarBlackoutFadeIn, () => {
            // Под чёрным экраном сбрасываем Punching и делаем swap
            if (this.officerKnock) this.officerKnock.resetPose();
            if (!this._performSwapDuringBlackout()) return;
            this._fadeNode(this.fadeToBlack, 0, this.hitCarBlackoutFadeOut, () => {
                this._onSwapComplete();
            });
        });
    }

    /** Swap водителя + копа (skin2) и кадр ареста — только пока экран чёрный. */
    private _performSwapDuringBlackout(): boolean {
        const swapped = this._swapBanditCharacters();
        this._swapOfficerToArrestSkin();
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
        BanditSwap.lockLod0AllCharacters();
        if (this.hitCar) this.hitCar.lockDriverHidden();
        this._swapDone = true;
        return true;
    }
    /** Prep перед ездой: тени/LOD/фары/detach офицера. */
    private _prepForDrive(): void {
        if (this._prepDone) return;

        DrivePerfFix.apply();
        RoadTilingFix.fixInScene();
        FakeLightGlow.replaceHeadlightsOnly();
        this._detachOfficerFromCar();
        if (this.carDrive) this.carDrive.warmUp();

        this._prepDone = true;
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
        PortraitPerf.setWantedOrArrestActive(true);
        // На всякий случай — если мигалки сбили, снова запустить
        if (this.sirenFlasher) this.sirenFlasher.startFlashing();

        // Ещё раз сбросить Punching — иначе на packshot коп «залипает» в замахе
        if (this.officerKnock) this.officerKnock.resetPose();

        this._showSubtitle("And if you think you can handle real patrol work, OneState is calling!", 4.0);
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

        const fadeIn = 1.0;

        const reveal = () => {
            if (this.moneyCounter) this.moneyCounter.node.active = false;

            // Чёрный фон ОСТАЁТСЯ под EndCard — не гасим FadeToBlack
            if (this.fadeToBlack) {
                this._setOp(this.fadeToBlack, 255);
                this.fadeToBlack.active = true;
            }
            if (this.endCard) {
                this.endCard.node.active = true;
                this._bringEndCardOnTop();
                this.endCard.show();
            }
        };

        if (!this.fadeToBlack) {
            reveal();
            return;
        }

        this.fadeToBlack.active = true;
        this._bringFadeOnTop();
        this._setOp(this.fadeToBlack, 0);
        this._fadeNode(this.fadeToBlack, 255, fadeIn, reveal);
    }

    /** Чёрный оверлей на весь экран. */
    private _bringFadeOnTop(): void {
        const fade = this.fadeToBlack;
        if (!fade?.parent) return;
        fade.setSiblingIndex(fade.parent.children.length - 1);
    }

    /** EndCard поверх чёрного фона. */
    private _bringEndCardOnTop(): void {
        const card = this.endCard?.node;
        if (!card?.parent) return;
        card.setSiblingIndex(card.parent.children.length - 1);
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
        const camNode = this._activeCamNode();
        if (!camNode) return;

        Tween.stopAllByTarget(camNode);
        const startPos = camNode.position.clone();
        const endPos = new Vec3(startPos.x, startPos.y + 1.0, startPos.z + 3.5);

        tween(camNode)
            .to(3.0, { position: endPos }, { easing: 'sineInOut' })
            .start();
    }

    /** Под чёрным экраном: деактивировать ManPolice_skin1, активировать ManPolice_skin2. */
    private _swapOfficerToArrestSkin(): void {
        if (this.arrestedPose) {
            this.arrestedPose.swapOfficerToArrestPose();
            return;
        }
        // Fallback без ArrestedPoseController — поиск по имени в сцене
        const skin1 = BanditSwap.findInScene('ManPolice_skin1')
            ?? BanditSwap.findInScene('ManPolice-skin1');
        const skin2 = BanditSwap.findInScene('ManPolice_skin2')
            ?? BanditSwap.findInScene('ManPolice-skin2')
            ?? BanditSwap.findInScene('manpolice-skin2');
        if (!skin2) {
            console.warn('[GameFlow] ManPolice_skin2 not found');
            return;
        }
        if (skin1) BanditSwap.hideDriver(skin1);
        BanditSwap.showArrested(skin2);
        BanditSwap.lockLod0(skin2);
        BanditSwap.lockLod0AllCharacters();
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

    /** Поднимает баббл (radiomessage) выше DocumentCard. */
    private _ensureSubtitleOnTop(): void {
        if (!this.subtitle) return;
        const bubble = this.subtitle.node.parent ?? this.subtitle.node;
        const parent = bubble.parent;
        if (!parent) return;

        bubble.setSiblingIndex(parent.children.length - 1);

        if (this.docCheck) {
            const docIdx = this.docCheck.node.getSiblingIndex();
            const bubIdx = bubble.getSiblingIndex();
            if (bubIdx <= docIdx) {
                bubble.setSiblingIndex(docIdx + 1);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Утилиты
    // ═══════════════════════════════════════════════════════════════════════

    /** Текст внутри radiomessage (баббл) — не вылезает за края. */
    private _styleSubtitle(): void {
        if (!this.subtitle) return;
        const lbl = this.subtitle;
        const bubble = lbl.node.parent;
        const bubbleUt = bubble?.getComponent(UITransform);

        // Внутренний паддинг бабла (в локальных единицах родителя)
        const padX = 70;
        const padY = 40;
        let maxW = 360;
        let maxH = 140;
        if (bubbleUt) {
            maxW = Math.max(120, bubbleUt.contentSize.width - padX * 2);
            maxH = Math.max(60, bubbleUt.contentSize.height - padY * 2);
        }

        // Компенсация если у Label свой scale (баббл scale отдельно)
        const sx = Math.max(0.01, Math.abs(lbl.node.scale.x) || 1);
        const localMaxW = maxW / sx;
        const localMaxH = maxH / sx;

        const portrait = view.getVisibleSize().height >= view.getVisibleSize().width;
        const fontSize = portrait ? 28 : 32;

        lbl.fontSize = fontSize;
        lbl.lineHeight = fontSize + 6;
        lbl.isBold = true;
        lbl.enableWrapText = true;
        lbl.overflow = Label.Overflow.RESIZE_HEIGHT;
        lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
        lbl.verticalAlign = Label.VerticalAlign.CENTER;

        const uit = lbl.node.getComponent(UITransform);
        if (uit) {
            uit.setContentSize(localMaxW, Math.min(localMaxH, fontSize * 3.2));
            uit.setAnchorPoint(0.5, 0.5);
        }

        // Не тянем Widget к низу Canvas — субтитр должен сидеть внутри бабла
        const widget = lbl.node.getComponent(Widget);
        if (widget) {
            widget.enabled = false;
        }
        // Центр бабла (редакторская поза ок, слегка центрируем)
        lbl.node.setPosition(0, 8, 0);

        lbl.enableOutline = true;
        lbl.outlineColor = new Color(0, 0, 0, 230);
        lbl.outlineWidth = portrait ? 2 : 3;
        lbl.enableShadow = true;
        lbl.shadowColor = new Color(0, 0, 0, 160);
        lbl.shadowOffset.set(0, -2);
        lbl.shadowBlur = 2;
    }

    private _showSubtitle(text: string, visibleDuration: number): void {
        if (!this.subtitle) return;
        const lbl = this.subtitle;
        this._styleSubtitle();

        const bubble = lbl.node.parent;
        if (bubble?.parent) {
            bubble.setSiblingIndex(bubble.parent.children.length - 1);
        }

        lbl.string = text;
        lbl.node.active = true;
        if (bubble) bubble.active = true;

        // Появление «из темноты»: баббл + текст 0 → 255
        this._setOp(lbl.node, 0);
        if (bubble) this._setOp(bubble, 0);

        const lblOp = lbl.node.getComponent(UIOpacity) ?? lbl.node.addComponent(UIOpacity);
        Tween.stopAllByTarget(lblOp);
        if (bubble) {
            const bOp = bubble.getComponent(UIOpacity) ?? bubble.addComponent(UIOpacity);
            Tween.stopAllByTarget(bOp);
            tween(bOp)
                .to(0.45, { opacity: 255 }, { easing: 'sineOut' })
                .delay(visibleDuration)
                .to(0.4, { opacity: 0 }, { easing: 'sineIn' })
                .call(() => { if (bubble.isValid) bubble.active = false; })
                .start();
        }

        tween(lblOp)
            .to(0.45, { opacity: 255 }, { easing: 'sineOut' })
            .delay(visibleDuration)
            .to(0.4, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => { if (lbl.node.isValid) lbl.node.active = false; })
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

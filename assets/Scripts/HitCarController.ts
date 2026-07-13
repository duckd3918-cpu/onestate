import {
    _decorator, Component, Node, tween, Tween, Vec3, Quat, Camera,
    input, Input, EventTouch, MeshRenderer, Material, Color,
    AudioClip, AudioSource,
} from 'cc';
import { BanditSwap } from './BanditSwap';

const { ccclass, property } = _decorator;

interface CarMatSnapshot {
    mat: Material;
    mainColor: Color;
    emissive: Color;
}

/**
 * HitCarController — мини-игра "бей по машине".
 * Тап → анимация удара офицера → playHitImpact() на момент strike.
 */
@ccclass('HitCarController')
export class HitCarController extends Component {

    @property({ type: Node, tooltip: 'Нода машины (тапы). Если не задана — берём this.node.' })
    driverCar: Node | null = null;

    @property({ type: Node, tooltip: 'Нода двери (для анимации открытия).' })
    driverDoor: Node | null = null;

    @property({ type: Node, tooltip: 'Нода водителя Bandit' })
    driver: Node | null = null;

    @property({ type: Node, tooltip: 'Нода 3D-камеры' })
    cameraNode: Node | null = null;

    @property({ tooltip: 'Количество ударов' })
    tapsRequired: number = 4;

    @property({ tooltip: 'Интенсивность тряски машины' })
    shakeIntensity: number = 0.09;

    @property({ tooltip: 'Интенсивность тряски камеры' })
    cameraShakeIntensity: number = 0.28;

    @property({ tooltip: 'Секунд на приближение камеры' })
    cameraZoomInTime: number = 0.8;

    @property({ tooltip: 'Если false — не двигаем камеру при begin()' })
    zoomCameraOnBegin: boolean = true;

    @property({ tooltip: 'Позиция камеры к окну' })
    cameraZoomPos: Vec3 = new Vec3(0.35, 1.95, 8.45);

    @property({ tooltip: 'Углы камеры к окну' })
    cameraZoomRot: Vec3 = new Vec3(-8, -5, 0);

    @property({ tooltip: 'Секунд на открытие двери' })
    doorSwingTime: number = 0.6;

    @property({ tooltip: 'Угол Y открытия двери' })
    doorOpenAngleY: number = -65;

    @property({ tooltip: 'Пульс emissive на кузове (выкл.)' })
    carHighlightEnabled: boolean = false;

    @property({ tooltip: 'Половина цикла пульса (сек)' })
    carHighlightPulseHalfPeriod: number = 0.55;

    @property({ tooltip: 'Сила подсветки 0–1' })
    carHighlightStrength: number = 0.65;

    @property({ type: AudioClip, tooltip: 'windowhit.mp3 — звук удара по машине' })
    audioWindowHit: AudioClip | null = null;

    public onExitComplete: (() => void) | null = null;
    public onFirstHit: (() => void) | null = null;
    public onHit: ((hitIndex: number) => void) | null = null;
    public onProgress: ((current: number, total: number) => void) | null = null;
    /** После визуального удара (тряска) — для UI HP-бара. */
    public onImpact: (() => void) | null = null;

    private _taps: number = 0;
    private _strikes: number = 0;
    private _exiting: boolean = false;
    private _active: boolean = false;
    private _driverLockedHidden: boolean = false;
    private _camBaseFov: number = 0;
    private _camComp: Camera | null = null;
    private _carMatSnapshots: CarMatSnapshot[] = [];
    private _highlightPulse: { t: number } | null = null;
    private _hitAudio: AudioSource | null = null;

    onLoad(): void {
        this._resolveDriver();
        this._destroyLeftoverRimGlows();
        this._hitAudio = this.getComponent(AudioSource) ?? this.addComponent(AudioSource);
    }

    onDestroy(): void {
        this._stopCarHighlight();
        this._unregisterInput();
    }

    public begin(): void {
        if (this._driverLockedHidden) return;

        this._taps = 0;
        this._strikes = 0;
        this._exiting = false;
        this._active = true;

        if (this.driverDoor) this.driverDoor.setRotationFromEuler(0, 0, 0);
        this._resolveDriver();
        this._cacheCamera();
        this._destroyLeftoverRimGlows();

        if (this.zoomCameraOnBegin) this._zoomCameraToWindow();
        if (this.carHighlightEnabled) {
            try {
                this._startCarHighlight();
            } catch (e) {
                console.warn('[HitCar] highlight failed:', e);
            }
        }
        this._unregisterInput();
        input.on(Input.EventType.TOUCH_START, this._onCarTap, this);

        if (this.onProgress) this.onProgress(0, this.tapsRequired);
    }

    public disable(): void {
        this._active = false;
        this._stopCarHighlight();
        this._unregisterInput();
    }

    public lockDriverHidden(): void {
        this._driverLockedHidden = true;
        this._active = false;
        this._unregisterInput();
        BanditSwap.hideAllDrivers(this.node, this.driver);
    }

    /** Тряска в момент strike офицера. */
    public playHitImpact(): void {
        this._strikes++;
        const ramp = 0.75 + 0.35 * Math.min(1, this._strikes / Math.max(1, this.tapsRequired));
        this._shakeCar(ramp);
        this._shakeCamera(ramp);
        this._playWindowHit();
        if (this.onImpact) this.onImpact();
    }

    private _playWindowHit(): void {
        if (!this.audioWindowHit) return;
        if (!this._hitAudio) {
            this._hitAudio = this.getComponent(AudioSource) ?? this.addComponent(AudioSource);
        }
        this._hitAudio.playOneShot(this.audioWindowHit, 1);
    }

    private _unregisterInput(): void {
        input.off(Input.EventType.TOUCH_START, this._onCarTap, this);
    }

    private _cacheCamera(): void {
        if (!this.cameraNode) {
            this._camComp = null;
            return;
        }
        this._camComp = this.cameraNode.getComponent(Camera);
        if (this._camComp) this._camBaseFov = this._camComp.fov;
    }

    private _zoomCameraToWindow(): void {
        if (!this.cameraNode) return;
        const targetQuat = new Quat();
        Quat.fromEuler(targetQuat, this.cameraZoomRot.x, this.cameraZoomRot.y, this.cameraZoomRot.z);
        tween(this.cameraNode)
            .to(this.cameraZoomInTime, {
                position: new Vec3(this.cameraZoomPos.x, this.cameraZoomPos.y, this.cameraZoomPos.z),
                rotation: targetQuat,
            }, { easing: 'sineInOut' })
            .start();
    }

    private _shakeCamera(ramp: number = 1): void {
        if (!this.cameraNode) return;
        const d = this.cameraShakeIntensity * ramp;
        const n = this.cameraNode;
        const startPos = n.position.clone();
        const baseEuler = n.eulerAngles.clone();
        Tween.stopAllByTarget(n);
        n.setPosition(startPos);
        n.setRotationFromEuler(baseEuler.x, baseEuler.y, baseEuler.z);
        tween(n)
            .by(0.04, {
                position: new Vec3(d * 1.2, d * 0.7, d * 0.35),
                eulerAngles: new Vec3(-2.5, 1.5, 3.5),
            })
            .by(0.06, {
                position: new Vec3(-d * 2.2, -d * 1.1, -d * 0.5),
                eulerAngles: new Vec3(4, -3, -5),
            })
            .by(0.05, {
                position: new Vec3(d * 1.0, d * 0.4, d * 0.15),
                eulerAngles: new Vec3(-1.2, 1.0, 1.5),
            })
            .to(0.08, {
                position: startPos,
                eulerAngles: baseEuler,
            }, { easing: 'sineOut' })
            .start();
        this._punchFov();
    }

    private _punchFov(): void {
        if (!this._camComp || this._camBaseFov <= 0) return;
        const cam = this._camComp;
        const base = this._camBaseFov;
        Tween.stopAllByTarget(cam);
        cam.fov = base;
        tween(cam)
            .to(0.05, { fov: base + 4.5 }, { easing: 'quadOut' })
            .to(0.14, { fov: base }, { easing: 'sineOut' })
            .start();
    }

    private _onCarTap(_event: EventTouch): void {
        if (!this._active || this._exiting || this._driverLockedHidden) return;
        this._taps++;

        if (this._taps === 1 && this.onFirstHit) this.onFirstHit();
        if (this.onProgress) this.onProgress(this._taps, this.tapsRequired);
        if (this.onHit) this.onHit(this._taps - 1);

        if (this._taps >= this.tapsRequired) {
            this._active = false;
            this._unregisterInput();
            // Даём Punching дойти до удара (клип ~0.8s, speed 1.15 → impact ~0.3s)
            this.scheduleOnce(() => this._triggerExit(), 0.45);
        }
    }

    private _shakeCar(ramp: number = 1): void {
        const car = this.driverCar ?? this.node;
        const d = this.shakeIntensity * ramp;
        const startPos = car.position.clone();
        const startEuler = car.eulerAngles.clone();
        Tween.stopAllByTarget(car);
        car.setPosition(startPos);
        car.setRotationFromEuler(startEuler.x, startEuler.y, startEuler.z);
        tween(car)
            .by(0.04, {
                position: new Vec3(d * 1.4, d * 0.35, 0),
                eulerAngles: new Vec3(0, 0, 2.2),
            })
            .by(0.07, {
                position: new Vec3(-d * 2.6, -d * 0.25, 0),
                eulerAngles: new Vec3(0, 0, -3.5),
            })
            .by(0.05, {
                position: new Vec3(d * 1.3, d * 0.1, 0),
                eulerAngles: new Vec3(0, 0, 1.5),
            })
            .to(0.07, {
                position: startPos,
                eulerAngles: startEuler,
            }, { easing: 'sineOut' })
            .start();
    }

    private _triggerExit(): void {
        if (this._exiting) return;
        this._exiting = true;
        this._stopCarHighlight();
        this.onExitComplete && this.onExitComplete();
    }

    /** Убрать сломанные RimGlow-оверлеи от прошлой версии. */
    private _destroyLeftoverRimGlows(): void {
        const root = this.driverCar ?? this.node;
        if (!root?.isValid) return;
        const doom: Node[] = [];
        const walk = (n: Node) => {
            if (n.name === 'RimGlow') doom.push(n);
            for (const c of n.children) walk(c);
        };
        walk(root);
        for (const n of doom) {
            if (n.isValid) n.destroy();
        }
    }

    /** Мягкий пульс emissive только на body_paint — без дублирования мешей. */
    private _startCarHighlight(): void {
        this._stopCarHighlight();
        const car = this.driverCar ?? this.node;
        if (!car?.isValid) return;

        this._carMatSnapshots = [];
        const renderers = car.getComponentsInChildren(MeshRenderer);
        for (const mr of renderers) {
            if (!mr.enabled || !mr.node.activeInHierarchy) continue;
            const nodeName = mr.node.name.toLowerCase();
            if (nodeName.includes('rimglow') || nodeName.includes('fakeglow')) continue;
            if (nodeName.includes('bandit') || nodeName.includes('wheel')) continue;

            for (let i = 0; i < mr.materials.length; i++) {
                const shared = mr.getSharedMaterial(i);
                if (!shared) continue;
                const matName = (shared.name || '').toLowerCase();
                // Только краска кузова — не трогаем стекло/фары/прочее
                if (!matName.includes('body_paint') && !matName.includes('body-paint')) continue;

                const inst = mr.getMaterialInstance(i);
                if (!inst) continue;

                const mainColor = this._readColorProp(inst, 'mainColor')
                    ?? this._readColorProp(inst, 'baseColor')
                    ?? new Color(255, 255, 255, 255);
                const emissive = this._readColorProp(inst, 'emissive')
                    ?? new Color(0, 0, 0, 255);

                this._carMatSnapshots.push({ mat: inst, mainColor, emissive });
            }
        }

        if (this._carMatSnapshots.length === 0) return;

        this._highlightPulse = { t: 0 };
        this._applyHighlightPulse(0);
        tween(this._highlightPulse)
            .repeatForever(
                tween(this._highlightPulse)
                    .to(this.carHighlightPulseHalfPeriod, { t: 1 }, {
                        easing: 'sineInOut',
                        onUpdate: () => this._applyHighlightPulse(this._highlightPulse!.t),
                    })
                    .to(this.carHighlightPulseHalfPeriod, { t: 0 }, {
                        easing: 'sineInOut',
                        onUpdate: () => this._applyHighlightPulse(this._highlightPulse!.t),
                    }),
            )
            .start();
    }

    private _applyHighlightPulse(t: number): void {
        const k = t * this.carHighlightStrength;
        for (const snap of this._carMatSnapshots) {
            if (!snap.mat?.isValid) continue;
            // Лёгкое осветление + тёплое emissive — материалы не ломаем
            const main = new Color(
                Math.min(255, snap.mainColor.r + 35 * k),
                Math.min(255, snap.mainColor.g + 40 * k),
                Math.min(255, snap.mainColor.b + 18 * k),
                snap.mainColor.a,
            );
            const em = new Color(
                Math.min(255, snap.emissive.r + 200 * k),
                Math.min(255, snap.emissive.g + 170 * k),
                Math.min(255, snap.emissive.b + 80 * k),
                255,
            );
            this._setColorProp(snap.mat, 'mainColor', main);
            this._setColorProp(snap.mat, 'emissive', em);
        }
    }

    private _stopCarHighlight(): void {
        if (this._highlightPulse) {
            Tween.stopAllByTarget(this._highlightPulse);
            this._highlightPulse = null;
        }
        for (const snap of this._carMatSnapshots) {
            if (!snap.mat?.isValid) continue;
            this._setColorProp(snap.mat, 'mainColor', snap.mainColor);
            this._setColorProp(snap.mat, 'emissive', snap.emissive);
        }
        this._carMatSnapshots = [];
        this._destroyLeftoverRimGlows();
    }

    private _readColorProp(mat: Material, name: string): Color | null {
        try {
            const v = mat.getProperty(name);
            if (v instanceof Color) return v.clone();
            if (v && typeof v === 'object' && 'r' in v) {
                const o = v as { r: number; g: number; b: number; a?: number };
                return new Color(o.r, o.g, o.b, o.a ?? 255);
            }
        } catch (_) { /* missing */ }
        return null;
    }

    private _setColorProp(mat: Material, name: string, c: Color): void {
        try { mat.setProperty(name, c); } catch (_) { /* ignore */ }
    }

    private _resolveDriver(): void {
        if (this.driver?.name === 'Bandit') return;
        for (const child of this.node.children) {
            if (child.name === 'Bandit') {
                this.driver = child;
                return;
            }
        }
    }
}

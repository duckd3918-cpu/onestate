import {
    _decorator, Component, Node, Vec3, Tween, tween,
    SkeletalAnimation, AnimationClip, assetManager, Asset,
} from 'cc';

const { ccclass, property } = _decorator;

/** Reaching Out.fbx → mixamo.com.animation */
const REACHING_OUT_UUID = '08daa47d-8218-44d9-bcac-9231aad1e4aa@18d6f';
/** Своё имя стейта — не пересекается с Punching (тоже mixamo.com). */
const REACHING_STATE = 'reaching_out';

/**
 * OfficerArmController
 *
 * Intro-жест: Reaching Out.
 *   play вперёд (ускоренно) → пауза 1с → откат скрубом time (end→0) → callback
 */
@ccclass('OfficerArmController')
export class OfficerArmController extends Component {
    @property({ type: SkeletalAnimation, tooltip: 'SkeletalAnimation на ManPolice (пусто = с этой ноды)' })
    skeletalAnim: SkeletalAnimation | null = null;

    @property({ type: AnimationClip, tooltip: 'Reaching Out (пусто = грузим по UUID)' })
    reachingClip: AnimationClip | null = null;

    @property({ tooltip: 'Множитель скорости (1.5–2). Анимация изначально медленная.' })
    playbackSpeed: number = 1.75;

    @property({ tooltip: 'Секунд держать руку на конце перед обратным проигрыванием' })
    holdAtEnd: number = 1.0;

    // ── legacy (tween fallback / редактор) ───────────────────────────────
    @property({ type: Node, tooltip: 'Нода правой руки (legacy tween fallback)' })
    rightArmBone: Node | null = null;

    @property({ type: Node, tooltip: '(опционально) предплечье' })
    rightForearmBone: Node | null = null;

    @property({ tooltip: 'Угол подъёма руки (legacy)' })
    raiseAngleZ: number = 90;

    @property({ tooltip: 'Начальный угол (legacy)' })
    restAngleZ: number = 0;

    @property({ tooltip: 'Наклон предплечья (legacy)' })
    forearmAngleX: number = -30;

    @property({ tooltip: 'Hold для legacy tween' })
    holdDuration: number = 1.5;

    @property({ tooltip: 'Скорость подъёма (legacy, сек)' })
    raiseDuration: number = 0.9;

    @property({ tooltip: 'Скорость опускания (legacy, сек)' })
    lowerDuration: number = 0.8;

    public onGestureComplete: (() => void) | null = null;

    private _restEuler: Vec3 = new Vec3();
    private _restForearmEuler: Vec3 = new Vec3();
    private _clipReady = false;
    private _loadingPromise: Promise<void> | null = null;
    private _gestureToken = 0;
    private _disabled = false;
    private _timeProxy: { t: number } = { t: 0 };

    onLoad(): void {
        if (/skin2/i.test(this.node.name)) {
            this._disabled = true;
            return;
        }

        if (this.rightArmBone) {
            this._restEuler = this.rightArmBone.eulerAngles.clone();
        }
        if (this.rightForearmBone) {
            this._restForearmEuler = this.rightForearmBone.eulerAngles.clone();
        }

        this._resolveSkeletalAnim();
        void this.preload().then(() => this.holdStartFrame());
    }

    public preload(): Promise<void> {
        if (this._disabled) return Promise.resolve();
        if (this._clipReady) return Promise.resolve();
        if (this._loadingPromise) return this._loadingPromise;

        this._resolveSkeletalAnim();
        this._loadingPromise = this._loadClip().then((clip) => {
            this.reachingClip = clip;
            this._registerState(clip);
            this._clipReady = true;
        }).catch((err) => {
            console.error('[OfficerArm] Reaching Out load failed', err);
            this._loadingPromise = null;
        });

        return this._loadingPromise ?? Promise.resolve();
    }

    /** Первый кадр Reaching Out, анимация на паузе (стартовая поза). */
    public holdStartFrame(): void {
        if (this._disabled || !this.skeletalAnim || !this.reachingClip) return;

        this._stopScheduled();
        const anim = this.skeletalAnim;
        const clip = this.reachingClip;

        anim.enabled = true;
        try { anim.resume(); } catch (_) { /* */ }

        let state = anim.getState(REACHING_STATE);
        if (!state) {
            this._registerState(clip);
            state = anim.getState(REACHING_STATE);
        }
        if (state) {
            state.wrapMode = AnimationClip.WrapMode.Normal;
            state.speed = 0;
            state.time = 0;
        }
        anim.play(REACHING_STATE);
        try { (state as any)?.sample?.(); } catch (_) { /* */ }
    }

    /**
     * Intro: Reaching Out вперёд (ускоренно) → hold → назад.
     */
    public playStopGesture(): void {
        if (this._disabled) {
            if (this.onGestureComplete) this.onGestureComplete();
            return;
        }

        void this.preload().then(() => {
            if (!this.skeletalAnim || !this.reachingClip) {
                this._playLegacyTween();
                return;
            }

            this._stopScheduled();
            const token = ++this._gestureToken;
            const anim = this.skeletalAnim;
            const clip = this.reachingClip;
            const speed = Math.max(0.1, this.playbackSpeed);

            anim.enabled = true;
            try { anim.resume(); } catch (_) { /* */ }

            let state = anim.getState(REACHING_STATE);
            if (!state) {
                this._registerState(clip);
                state = anim.getState(REACHING_STATE);
            }
            if (state) {
                state.wrapMode = AnimationClip.WrapMode.Normal;
                state.speed = speed;
                state.time = 0;
            }

            anim.play(REACHING_STATE);
            // Снова выставить после play() — Cocos может сбросить time
            if (state) {
                state.time = 0;
                state.speed = speed;
            }

            // Чуть раньше конца, чтобы клип не «отщёлкнул» на stop сам
            const forwardDur = Math.max(0.01, (clip.duration || 2) / speed - 0.02);
            this.scheduleOnce(() => {
                if (token !== this._gestureToken) return;
                this._holdThenReverse(token, speed);
            }, forwardDur);
        });
    }

    public resetPose(): void {
        if (this._clipReady && this.reachingClip) {
            this.holdStartFrame();
            return;
        }
        this._stopScheduled();
        if (this.skeletalAnim) {
            try { this.skeletalAnim.stop(); } catch (_) { /* */ }
        }
        if (this.rightArmBone) {
            Tween.stopAllByTarget(this.rightArmBone);
            this.rightArmBone.setRotationFromEuler(
                this._restEuler.x, this._restEuler.y, this._restEuler.z,
            );
        }
        if (this.rightForearmBone) {
            Tween.stopAllByTarget(this.rightForearmBone);
            this.rightForearmBone.setRotationFromEuler(
                this._restForearmEuler.x, this._restForearmEuler.y, this._restForearmEuler.z,
            );
        }
    }

    private _sampleState(state: any): void {
        try { state?.sample?.(); } catch (_) { /* */ }
    }

    /** Выставить кадр клипа при speed=0 (скруб времени). */
    private _scrubTo(state: any, time: number): void {
        if (!state) return;
        state.speed = 0;
        state.time = Math.max(0, time);
        this._sampleState(state);
    }

    private _holdThenReverse(token: number, speed: number): void {
        if (!this.skeletalAnim || !this.reachingClip) return;
        if (token !== this._gestureToken) return;

        const clip = this.reachingClip;
        const endTime = Math.max(0, clip.duration);
        const state = this.skeletalAnim.getState(REACHING_STATE);

        // Заморозка на конце
        this._scrubTo(state, endTime);

        this.scheduleOnce(() => {
            if (token !== this._gestureToken) return;
            this._playReverseScrub(token, speed, endTime);
        }, Math.max(0, this.holdAtEnd));
    }

    /**
     * Откат вручную: speed=0 и tween по state.time (end → 0).
     * Negative speed у Cocos SkeletalAnimation часто не работает / телепортит.
     */
    private _playReverseScrub(token: number, speed: number, endTime: number): void {
        if (!this.skeletalAnim || !this.reachingClip) return;
        if (token !== this._gestureToken) return;

        const anim = this.skeletalAnim;
        let state = anim.getState(REACHING_STATE);
        if (!state) {
            this._registerState(this.reachingClip);
            state = anim.getState(REACHING_STATE);
        }
        if (!state) {
            if (this.onGestureComplete) this.onGestureComplete();
            return;
        }

        anim.enabled = true;
        try { anim.resume(); } catch (_) { /* */ }

        // Держим стейт «играющим», но speed=0 — двигаем только time
        if (!state.isPlaying) {
            anim.play(REACHING_STATE);
        }
        this._scrubTo(state, endTime);

        const reverseDur = endTime / Math.max(0.1, speed);
        Tween.stopAllByTarget(this._timeProxy);
        this._timeProxy.t = endTime;

        tween(this._timeProxy)
            .to(reverseDur, { t: 0 }, {
                easing: 'linear',
                onUpdate: () => {
                    if (token !== this._gestureToken) return;
                    const st = this.skeletalAnim?.getState(REACHING_STATE);
                    this._scrubTo(st, this._timeProxy.t);
                },
            })
            .call(() => {
                if (token !== this._gestureToken) return;
                const st = this.skeletalAnim?.getState(REACHING_STATE);
                this._scrubTo(st, 0);
                if (this.onGestureComplete) this.onGestureComplete();
            })
            .start();
    }

    private _resolveSkeletalAnim(): void {
        if (this.skeletalAnim?.isValid) return;
        this.skeletalAnim = this.getComponent(SkeletalAnimation)
            ?? this.node.getComponent(SkeletalAnimation);
    }

    private _loadClip(): Promise<AnimationClip> {
        if (this.reachingClip) return Promise.resolve(this.reachingClip);

        return new Promise((resolve, reject) => {
            assetManager.loadAny({ uuid: REACHING_OUT_UUID }, (err, asset: Asset) => {
                if (err || !asset) {
                    reject(err ?? new Error('no asset'));
                    return;
                }
                resolve(asset as AnimationClip);
            });
        });
    }

    private _registerState(clip: AnimationClip): void {
        if (!this.skeletalAnim) return;

        // ОБА Mixamo-клипа зовутся "mixamo.com" — если пушить в clips= под тем же
        // именем, Cocos перезапишет Punching. Только createState со своим именем,
        // clips-массив аниматора НЕ трогаем.
        try {
            (clip as any).name = REACHING_STATE;
        } catch (_) { /* */ }
        clip.wrapMode = AnimationClip.WrapMode.Normal;

        try {
            if (this.skeletalAnim.getState(REACHING_STATE)) {
                this.skeletalAnim.removeState(REACHING_STATE);
            }
        } catch (_) { /* */ }

        try {
            this.skeletalAnim.createState(clip, REACHING_STATE);
        } catch (_) { /* already exists */ }
    }

    private _stopScheduled(): void {
        this._gestureToken++;
        this.unscheduleAllCallbacks();
        Tween.stopAllByTarget(this._timeProxy);
        if (this.rightArmBone) Tween.stopAllByTarget(this.rightArmBone);
        if (this.rightForearmBone) Tween.stopAllByTarget(this.rightForearmBone);
    }

    /** Fallback если клип не загрузился — старый tween. */
    private _playLegacyTween(): void {
        if (!this.rightArmBone) {
            if (this.onGestureComplete) this.onGestureComplete();
            return;
        }

        const restEuler = this._restEuler.clone();
        const raisedEuler = new Vec3(
            restEuler.x,
            restEuler.y,
            restEuler.z + this.raiseAngleZ,
        );

        tween(this.rightArmBone)
            .to(this.raiseDuration, { eulerAngles: raisedEuler }, { easing: 'sineOut' })
            .delay(this.holdDuration)
            .to(this.lowerDuration, { eulerAngles: restEuler }, { easing: 'sineInOut' })
            .call(() => { if (this.onGestureComplete) this.onGestureComplete(); })
            .start();

        if (this.rightForearmBone) {
            const restFA = this._restForearmEuler.clone();
            const raisedFA = new Vec3(
                restFA.x + this.forearmAngleX,
                restFA.y,
                restFA.z,
            );
            tween(this.rightForearmBone)
                .to(this.raiseDuration, { eulerAngles: raisedFA }, { easing: 'sineOut' })
                .delay(this.holdDuration)
                .to(this.lowerDuration, { eulerAngles: restFA }, { easing: 'sineInOut' })
                .start();
        }
    }
}

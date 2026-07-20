import {
    _decorator, Component, Node, SkeletalAnimation, AnimationClip,
    assetManager, Asset, Vec3, Quat,
} from 'cc';

const { ccclass, property } = _decorator;

/** UUID клипа Punching.fbx → mixamo.com */
export const PUNCH_CLIP_UUID = 'd0acb6bc-a395-47b5-b531-66f84b271c54@18d6f';

type RestBone = {
    node: Node;
    pos: Vec3;
    rot: Quat;
    scale: Vec3;
};

/**
 * OfficerKnockController — удар анимацией Punching на ManPolice.
 */
@ccclass('OfficerKnockController')
export class OfficerKnockController extends Component {

    @property({ type: SkeletalAnimation, tooltip: 'SkeletalAnimation на ManPolice (если пусто — берём с этой ноды)' })
    skeletalAnim: SkeletalAnimation | null = null;

    @property({ type: AnimationClip, tooltip: 'Клип Punching (если пусто — грузим по UUID)' })
    punchClip: AnimationClip | null = null;

    @property({ tooltip: 'Имя стейта. Пусто = имя клипа' })
    punchClipName: string = '';

    @property({ tooltip: 'Доля клипа (0–1) когда удар попадает → onKnock' })
    impactNormalizedTime: number = 0.42;

    @property({ tooltip: 'Скорость анимации' })
    playbackSpeed: number = 1.15;

    public onKnock: ((index: number) => void) | null = null;
    public onKnockComplete: (() => void) | null = null;

    private _running: boolean = false;
    private _struckThisSwing: boolean = false;
    private _clipName: string = 'mixamo.com';
    private _clipReady: boolean = false;
    private _pendingKnock: boolean = false;
    private _freezeAtImpact: boolean = false;
    private _restPose: RestBone[] = [];
    private _restCaptured: boolean = false;

    onLoad(): void {
        if (!this.skeletalAnim) {
            this.skeletalAnim = this.getComponent(SkeletalAnimation)
                ?? this.node.getComponent(SkeletalAnimation);
        }
        // До Punching — запомнить bind/idle-позу (кадр 0 Punching = уже замах)
        this._captureRestPose();
        this._loadClipIfNeeded();
    }

    private _captureRestPose(): void {
        if (this._restCaptured) return;
        const root = this.skeletalAnim?.node ?? this.node;
        if (!root?.isValid) return;

        this._restPose = [];
        const walk = (n: Node) => {
            this._restPose.push({
                node: n,
                pos: n.position.clone(),
                rot: n.rotation.clone(),
                scale: n.scale.clone(),
            });
            for (const c of n.children) walk(c);
        };
        walk(root);
        this._restCaptured = true;
    }

    private _restoreRestPose(): void {
        if (!this._restCaptured) this._captureRestPose();
        // Корень не трогаем — после detach от машины у него другой local transform
        const root = this.skeletalAnim?.node ?? this.node;
        for (const entry of this._restPose) {
            if (!entry.node?.isValid || entry.node === root) continue;
            entry.node.setPosition(entry.pos);
            entry.node.setRotation(entry.rot);
            entry.node.setScale(entry.scale);
        }
    }

    private _loadClipIfNeeded(): void {
        if (this.punchClip) {
            this._onClipReady(this.punchClip);
            return;
        }
        assetManager.loadAny({ uuid: PUNCH_CLIP_UUID }, (err, asset: Asset) => {
            if (err || !asset) {
                console.error('[OfficerKnock] failed to load Punching clip', err);
                return;
            }
            this.punchClip = asset as AnimationClip;
            this._onClipReady(this.punchClip);
            if (this._pendingKnock) {
                this._pendingKnock = false;
                this.singleKnock(this._freezeAtImpact);
            }
        });
    }

    /** Уже готов клип + стейт (для preload до Tap to Play). */
    public get isReady(): boolean {
        return this._clipReady && !!this.punchClip;
    }

    /**
     * Принудительно догрузить Punching и зарегистрировать стейт.
     * Можно звать с экрана Tap to Play — до первого удара.
     */
    public preload(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.skeletalAnim) {
                this.skeletalAnim = this.getComponent(SkeletalAnimation)
                    ?? this.node.getComponent(SkeletalAnimation);
            }
            if (this.isReady) {
                resolve();
                return;
            }
            if (this.punchClip) {
                this._onClipReady(this.punchClip);
                resolve();
                return;
            }
            assetManager.loadAny({ uuid: PUNCH_CLIP_UUID }, (err, asset: Asset) => {
                if (!err && asset) {
                    this.punchClip = asset as AnimationClip;
                    this._onClipReady(this.punchClip);
                } else {
                    console.error('[OfficerKnock] preload failed', err);
                }
                resolve();
            });
        });
    }

    private _onClipReady(clip: AnimationClip): void {
        if (!this.skeletalAnim) {
            console.warn('[OfficerKnock] no SkeletalAnimation on', this.node.name);
            return;
        }

        // Всегда уникальное имя — Reaching Out тоже mixamo.com и иначе затирает удар
        this._clipName = (this.punchClipName || 'punching').trim();
        if (this._clipName === 'mixamo.com' || this._clipName.endsWith('.animation')) {
            this._clipName = 'punching';
        }

        try { (clip as any).name = this._clipName; } catch (_) { /* */ }
        clip.wrapMode = AnimationClip.WrapMode.Normal;

        const clips = this.skeletalAnim.clips ? [...this.skeletalAnim.clips] : [];
        if (!clips.includes(clip)) {
            clips.push(clip);
            this.skeletalAnim.clips = clips;
        }
        this.skeletalAnim.defaultClip = clip;

        try {
            if (this.skeletalAnim.getState(this._clipName)) {
                this.skeletalAnim.removeState(this._clipName);
            }
        } catch (_) { /* */ }

        try {
            this.skeletalAnim.createState(clip, this._clipName);
        } catch (_) { /* already exists */ }

        this._clipReady = true;
        console.log('[OfficerKnock] punch ready:', this._clipName, 'dur=', clip.duration);
    }

    /**
     * @param freezeAtImpact если true — на кадре удара анимация паузится
     *   (нужно для последнего удара до fade to black).
     */
    public singleKnock(freezeAtImpact: boolean = false): void {
        if (!this.skeletalAnim) {
            this.skeletalAnim = this.getComponent(SkeletalAnimation);
        }
        if (!this._clipReady || !this.punchClip || !this.skeletalAnim) {
            // Клип ещё грузится — повторим удар после загрузки
            this._pendingKnock = true;
            this._freezeAtImpact = freezeAtImpact;
            if (!this.punchClip) this._loadClipIfNeeded();
            console.warn('[OfficerKnock] clip not ready yet, will retry');
            return;
        }

        if (this._running && !this._struckThisSwing && this.onKnock) {
            this.onKnock(0);
        }

        this.unschedule(this._fireImpact);
        this.unschedule(this._fireComplete);

        this._running = true;
        this._struckThisSwing = false;
        this._freezeAtImpact = freezeAtImpact;

        const anim = this.skeletalAnim;
        const clip = this.punchClip;
        const name = this._clipName;

        anim.stop();

        // На случай если Reaching Out затёр стейт — пересоздаём Punching
        let state = anim.getState(name);
        if (!state || (state.clip && state.clip !== clip)) {
            try { if (state) anim.removeState(name); } catch (_) { /* */ }
            state = anim.createState(clip, name);
        }
        if (state) {
            state.wrapMode = AnimationClip.WrapMode.Normal;
            state.speed = this.playbackSpeed;
            state.time = 0;
        }

        anim.defaultClip = clip;
        anim.play(name);

        const duration = (clip.duration || 0.8) / Math.max(0.01, this.playbackSpeed);
        const impactAt = duration * Math.min(1, Math.max(0.05, this.impactNormalizedTime));

        this.scheduleOnce(this._fireImpact, impactAt);
        if (!freezeAtImpact) {
            this.scheduleOnce(this._fireComplete, duration + 0.02);
        }
    }

    public startKnocking(): void {
        this.singleKnock();
    }

    /** Остановить Punching и вернуть скелет в позу до анимации (не кадр 0 Punching). */
    public resetPose(): void {
        this.unschedule(this._fireImpact);
        this.unschedule(this._fireComplete);
        this._running = false;
        this._struckThisSwing = false;
        this._pendingKnock = false;

        if (!this.skeletalAnim) return;

        this.skeletalAnim.stop();
        this._restoreRestPose();
    }

    private _fireImpact = (): void => {
        if (this._struckThisSwing) return;
        this._struckThisSwing = true;
        if (this.onKnock) this.onKnock(0);

        // Последний удар: заморозить позу на кадре попадания до resetPose()
        if (this._freezeAtImpact && this.skeletalAnim) {
            this.unschedule(this._fireComplete);
            const state = this.skeletalAnim.getState(this._clipName)
                ?? (this.skeletalAnim.defaultClip
                    ? this.skeletalAnim.getState(this.skeletalAnim.defaultClip.name)
                    : null);
            if (state) {
                state.speed = 0;
            } else {
                this.skeletalAnim.pause();
            }
            this._running = false;
            this._freezeAtImpact = false;
        }
    };

    private _fireComplete = (): void => {
        this._running = false;
        if (!this._struckThisSwing) {
            this._struckThisSwing = true;
            if (this.onKnock) this.onKnock(0);
        }
        if (this.onKnockComplete) this.onKnockComplete();
    };
}

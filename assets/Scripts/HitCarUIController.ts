import {
    _decorator, Component, Node, tween, Tween, Vec3,
    UIOpacity, Label, UITransform, Color, Layers,
    Sprite, SpriteFrame, Texture2D, view, ProgressBar,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * HitCarUIController
 *
 * hitcarui
 *   ├── hpbar
 *   │     ├── hp       — cc.ProgressBar
 *   │     └── hplabel  — "100/100"
 *   ├── bg-001 / fist / taplabel-001
 */
@ccclass('HitCarUIController')
export class HitCarUIController extends Component {

    @property({ type: Label, tooltip: 'Лейбл HIT THE CAR (подсказка)' })
    label: Label | null = null;

    @property({ type: Label, tooltip: 'Числовой HP (100/100 → 0/100)' })
    hpLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Кулак (fist / hand)' })
    handNode: Node | null = null;

    @property({ type: Node, tooltip: 'Тёмный фон (bg / bg-001)' })
    bgNode: Node | null = null;

    @property({ type: Node, tooltip: 'hpbar — корень полоски HP' })
    progressRoot: Node | null = null;

    @property({ type: Node, tooltip: 'hp — нода с ProgressBar' })
    progressFill: Node | null = null;

    @property({ tooltip: 'Fade-in панели' })
    showTime: number = 0.35;

    @property({ tooltip: 'Fade-out панели в конце' })
    hideTime: number = 0.3;

    @property({ tooltip: 'Пик opacity круговой виньетки при ударе (0–255)' })
    hitVignettePeakOpacity: number = 210;

    @property({ tooltip: 'Секунд: темнота сжимается к центру' })
    hitVignetteInTime: number = 0.05;

    @property({ tooltip: 'Секунд: темнота уходит обратно к краям' })
    hitVignetteOutTime: number = 0.16;

    private _shown: boolean = false;
    private _hpVisible: boolean = false;
    private _progressBar: ProgressBar | null = null;
    private _hpProxy: { t: number } = { t: 1 };
    private _barBasePos: Vec3 = new Vec3();
    private _shakeOff: Vec3 = new Vec3();
    private _shakeProxy: { x: number; y: number } = { x: 0, y: 0 };
    private _hitVignette: Node | null = null;
    private _hitVignetteOp: UIOpacity | null = null;
    private static _vignetteSf: SpriteFrame | null = null;

    onLoad(): void {
        this._resolveRefs();
        this.node.active = false;
    }

    private _resolveRefs(): void {
        if (!this.handNode) {
            this.handNode = this.node.getChildByName('fist')
                ?? this.node.getChildByName('hand');
        }
        if (!this.bgNode) {
            this.bgNode = this.node.getChildByName('bg-001')
                ?? this.node.getChildByName('bg')
                ?? this.node.getChildByName('BG');
        }
        if (!this.label) {
            const lblNode = this.node.getChildByName('taplabel-001')
                ?? this.node.getChildByName('label')
                ?? this.node.getChildByName('taplabel');
            if (lblNode) this.label = lblNode.getComponent(Label);
        }

        // Всегда предпочитаем пользовательский hpbar (не ProgressBarHp)
        const hpbar = this.node.getChildByName('hpbar');
        if (hpbar) {
            this.progressRoot = hpbar;
            this.progressFill = hpbar.getChildByName('hp')
                ?? hpbar.getChildByName('Fill')
                ?? this.progressFill;
            const hpLbl = hpbar.getChildByName('hplabel')
                ?? hpbar.getChildByName('HpLabel');
            if (hpLbl) this.hpLabel = hpLbl.getComponent(Label);
        } else {
            if (!this.progressRoot) {
                this.progressRoot = this.node.getChildByName('ProgressBarHp')
                    ?? this.node.getChildByName('ProgressBar')
                    ?? this.node.getChildByName('HpBar');
            }
            if (!this.progressFill && this.progressRoot) {
                this.progressFill = this.progressRoot.getChildByName('hp')
                    ?? this.progressRoot.getChildByName('Fill');
            }
            if (!this.hpLabel && this.progressRoot) {
                const hpLbl = this.progressRoot.getChildByName('hplabel')
                    ?? this.node.getChildByName('hplabel');
                if (hpLbl) this.hpLabel = hpLbl.getComponent(Label);
            }
        }

        this._progressBar = this.progressFill?.getComponent(ProgressBar)
            ?? this.progressRoot?.getComponentInChildren(ProgressBar)
            ?? null;
    }

    public show(): void {
        this._resolveRefs();

        this.node.active = true;
        this._shown = true;
        this._setOpacity(this.node, 255);

        if (this.bgNode) {
            this.bgNode.active = true;
            this._setOpacity(this.bgNode, 180);
        }
        if (this.handNode) {
            Tween.stopAllByTarget(this.handNode);
            this.handNode.active = true;
            this.handNode.setScale(1, 1, 1);
        }
        if (this.label) {
            Tween.stopAllByTarget(this.label.node);
            this.label.node.active = true;
            this._setOpacity(this.label.node, 255);
        }
        // HP скрыт до первого тапа — иначе красная полоска сливается с HIT THE CAR
        this._hpVisible = false;
        if (this.progressRoot) {
            this.progressRoot.active = false;
            this._barBasePos.set(this.progressRoot.position);
        }
        if (this.hpLabel) this.hpLabel.node.active = false;

        // Старые плейсхолдеры
        for (const name of ['ProgressBarHp', 'ProgressBar', 'Progress', 'Label']) {
            const legacy = this.node.getChildByName(name);
            if (legacy && legacy !== this.progressRoot && legacy !== this.hpLabel?.node) {
                legacy.active = false;
            }
        }

        this._shakeOff.set(0, 0, 0);
        this._applyBarPos();

        this._pulsateLabel();
        this._animateHand();
    }

    /** Показать HP после первого тапа (когда подсказка уходит). */
    public showHpBar(): void {
        if (this._hpVisible) return;
        this._resolveRefs();
        this._hpVisible = true;

        if (this.progressRoot) {
            this.progressRoot.active = true;
            this._barBasePos.set(this.progressRoot.position);
        }
        if (this.hpLabel) this.hpLabel.node.active = true;

        this._shakeOff.set(0, 0, 0);
        this._applyBarPos();
        this.setHp(1);
    }

    public hideHint(): void {
        if (this.bgNode) {
            Tween.stopAllByTarget(this.bgNode);
            const bop = this.bgNode.getComponent(UIOpacity);
            if (bop) Tween.stopAllByTarget(bop);
            this.bgNode.active = false;
        }
        if (this.handNode) {
            Tween.stopAllByTarget(this.handNode);
            this.handNode.active = false;
        }
        if (this.label) {
            Tween.stopAllByTarget(this.label.node);
            const op = this.label.node.getComponent(UIOpacity);
            if (op) Tween.stopAllByTarget(op);
            this.label.node.active = false;
        }
    }

    public hide(): void {
        this.hideHint();
        this._hpVisible = false;
        if (this.progressRoot) this.progressRoot.active = false;
        if (this.hpLabel) this.hpLabel.node.active = false;
        this._stopHitVignette();

        if (!this._shown) {
            this.node.active = false;
            return;
        }
        this._shown = false;

        Tween.stopAllByTarget(this._hpProxy);
        Tween.stopAllByTarget(this._shakeProxy);
        this.node.active = false;
    }

    public setProgress(hits: number, total: number): void {
        if (!this._hpVisible) this.showHpBar();
        const hp = total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - hits / total));
        this.setHp(hp);
    }

    /** hp 1 = полное. Лейбл: 100/100 → 75/100 → … → 0/100 */
    public setHp(hp: number): void {
        this._resolveRefs();
        const t = Math.min(1, Math.max(0, hp));

        Tween.stopAllByTarget(this._hpProxy);
        const from = this._progressBar?.isValid ? this._progressBar.progress : this._hpProxy.t;
        this._hpProxy.t = from;
        this._applyHpVisual(from);

        tween(this._hpProxy)
            .to(0.22, { t }, {
                easing: 'sineOut',
                onUpdate: () => this._applyHpVisual(this._hpProxy.t),
            })
            .call(() => this._applyHpVisual(t))
            .start();

        if (this.hpLabel) {
            const value = Math.round(t * 100);
            this.hpLabel.string = `${value}/100`;
        }
    }

    private _applyHpVisual(t: number): void {
        const v = Math.min(1, Math.max(0, t));
        if (this._progressBar?.isValid) {
            this._progressBar.progress = v;
            return;
        }
        if (this.progressFill?.isValid) {
            // Не трогаем Y/Z scale — у hp уже scale.x из редактора
            const y = this.progressFill.scale.y;
            const z = this.progressFill.scale.z;
            const baseX = 0.722; // исходный scale.x бара в сцене
            this.progressFill.setScale(Math.max(0.001, baseX * v), y, z);
        }
    }

    public shakeBar(intensity: number = 22): void {
        if (!this.progressRoot?.isValid) return;
        if (this._shakeProxy.x === 0 && this._shakeProxy.y === 0) {
            this._barBasePos.set(
                this.progressRoot.position.x - this._shakeOff.x,
                this.progressRoot.position.y - this._shakeOff.y,
                0,
            );
        }
        Tween.stopAllByTarget(this._shakeProxy);
        this._shakeProxy.x = 0;
        this._shakeProxy.y = 0;
        const d = intensity;
        tween(this._shakeProxy)
            .to(0.04, { x: d, y: d * 0.45 }, { onUpdate: () => this._applyShakeOff() })
            .to(0.05, { x: -d * 1.15, y: -d * 0.35 }, { onUpdate: () => this._applyShakeOff() })
            .to(0.05, { x: d * 0.55, y: d * 0.25 }, { onUpdate: () => this._applyShakeOff() })
            .to(0.08, { x: 0, y: 0 }, {
                easing: 'sineOut',
                onUpdate: () => this._applyShakeOff(),
            })
            .start();
    }

    public pulseHitVignette(): void {
        this._ensureHitVignette();
        if (!this._hitVignette?.isValid || !this._hitVignetteOp) return;

        const n = this._hitVignette;
        const op = this._hitVignetteOp;
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(op);

        n.active = true;
        n.setScale(1.65, 1.65, 1);
        op.opacity = 0;

        const peak = this.hitVignettePeakOpacity;
        tween(n)
            .to(this.hitVignetteInTime, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'quadOut' })
            .to(this.hitVignetteOutTime, { scale: new Vec3(1.55, 1.55, 1) }, { easing: 'sineIn' })
            .call(() => {
                if (n.isValid) {
                    op.opacity = 0;
                    n.active = false;
                }
            })
            .start();

        tween(op)
            .to(this.hitVignetteInTime, { opacity: peak }, { easing: 'quadOut' })
            .to(this.hitVignetteOutTime, { opacity: 0 }, { easing: 'sineIn' })
            .start();
    }

    private _stopHitVignette(): void {
        if (!this._hitVignette?.isValid) return;
        Tween.stopAllByTarget(this._hitVignette);
        if (this._hitVignetteOp) Tween.stopAllByTarget(this._hitVignetteOp);
        if (this._hitVignetteOp) this._hitVignetteOp.opacity = 0;
        this._hitVignette.active = false;
    }

    private _ensureHitVignette(): void {
        if (this._hitVignette?.isValid && this._hitVignetteOp?.isValid) return;

        const parent = this.node.parent ?? this.node;
        let n = parent.getChildByName('HitImpactVignette');
        if (!n) {
            n = new Node('HitImpactVignette');
            n.layer = Layers.Enum.UI_2D;
            parent.addChild(n);
            n.setSiblingIndex(parent.children.length - 1);

            const ut = n.addComponent(UITransform);
            const vs = view.getVisibleSize();
            const side = Math.max(vs.width, vs.height) * 1.35;
            ut.setContentSize(side, side);
            ut.setAnchorPoint(0.5, 0.5);
            n.setPosition(0, 0, 0);

            const sp = n.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.spriteFrame = HitCarUIController._getVignetteSpriteFrame();
            sp.color = new Color(0, 0, 0, 255);

            const op = n.addComponent(UIOpacity);
            op.opacity = 0;
            this._hitVignetteOp = op;
        } else {
            this._hitVignetteOp = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
        }

        this._hitVignette = n;
        n.active = false;
    }

    private static _getVignetteSpriteFrame(): SpriteFrame {
        if (HitCarUIController._vignetteSf?.isValid) return HitCarUIController._vignetteSf;

        const size = 128;
        const data = new Uint8Array(size * size * 4);
        const cx = (size - 1) * 0.5;
        const cy = (size - 1) * 0.5;
        const maxR = size * 0.5;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const d = Math.hypot(x - cx, y - cy) / maxR;
                const t = Math.min(1, Math.max(0, (d - 0.15) / 0.85));
                const a = Math.pow(t, 1.35);
                const i = (y * size + x) * 4;
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                data[i + 3] = Math.min(255, Math.floor(a * 255));
            }
        }

        const tex = new Texture2D();
        tex.reset({
            width: size,
            height: size,
            format: Texture2D.PixelFormat.RGBA8888,
        });
        tex.uploadData(data);
        tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);

        const sf = new SpriteFrame();
        sf.texture = tex;
        HitCarUIController._vignetteSf = sf;
        return sf;
    }

    private _applyShakeOff(): void {
        this._shakeOff.set(this._shakeProxy.x, this._shakeProxy.y, 0);
        this._applyBarPos();
    }

    private _applyBarPos(): void {
        if (!this.progressRoot?.isValid) return;
        this.progressRoot.setPosition(
            this._barBasePos.x + this._shakeOff.x,
            this._barBasePos.y + this._shakeOff.y,
            0,
        );
    }

    private _pulsateLabel(): void {
        if (!this.label) return;
        const n = this.label.node;
        const op = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
        op.opacity = 255;
        Tween.stopAllByTarget(op);
        tween(op)
            .repeatForever(
                tween(op)
                    .to(0.6, { opacity: 255 }, { easing: 'sineOut' })
                    .to(0.6, { opacity: 100 }, { easing: 'sineIn' }),
            )
            .start();
    }

    private _animateHand(): void {
        if (!this.handNode) return;
        const h = this.handNode;
        h.setScale(1, 1, 1);
        Tween.stopAllByTarget(h);
        tween(h)
            .repeatForever(
                tween(h)
                    .to(0.6, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'sineOut' })
                    .to(0.6, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'sineIn' }),
            )
            .start();
    }

    private _setOpacity(node: Node, a: number): void {
        const op = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        op.opacity = a;
    }
}

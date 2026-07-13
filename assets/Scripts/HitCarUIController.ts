import {
    _decorator, Component, Node, tween, Tween, Vec3,
    UIOpacity, Label, UITransform, Graphics, Color, Layers,
    Sprite, SpriteFrame, Texture2D, view,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * HitCarUIController
 *
 * hitcarui
 *   ├── bg-001 / bg     — тёмный оверлей (прячется на первом тапе)
 *   ├── fist / hand     — кулак (прячется на первом тапе)
 *   ├── taplabel-001    — текст
 *   └── ProgressBar     — твоя нода: сюда вешаем HP (размер = UITransform ноды)
 *         └── Fill      — красная заливка, якорь слева, scale.x = hp
 */
@ccclass('HitCarUIController')
export class HitCarUIController extends Component {

    @property({ type: Label, tooltip: 'Лейбл HIT THE CAR' })
    label: Label | null = null;

    @property({ type: Node, tooltip: 'Кулак (fist / hand)' })
    handNode: Node | null = null;

    @property({ type: Node, tooltip: 'Тёмный фон (bg / bg-001)' })
    bgNode: Node | null = null;

    @property({ type: Node, tooltip: 'Твоя нода ProgressBar — размер бара берётся с неё' })
    progressRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Fill внутри ProgressBar (создаётся сам если пусто)' })
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
    private _fillGfx: Graphics | null = null;
    private _barW: number = 400;
    private _barH: number = 36;
    private _barBasePos: Vec3 = new Vec3();
    private _shakeOff: Vec3 = new Vec3();
    private _shakeProxy: { x: number; y: number } = { x: 0, y: 0 };
    private _hitVignette: Node | null = null;
    private _hitVignetteOp: UIOpacity | null = null;
    private static _vignetteSf: SpriteFrame | null = null;

    onLoad(): void {
        this._resolveRefs();
        this._ensureHpBar();
        // На старте панели быть не должно
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
        if (!this.progressRoot) {
            this.progressRoot = this.node.getChildByName('ProgressBarHp')
                ?? this.node.getChildByName('ProgressBar')
                ?? this.node.getChildByName('Progress')
                ?? this.node.getChildByName('HpBar');
        }
    }

    public show(): void {
        this._resolveRefs();
        this._ensureHpBar();

        this.node.active = true;
        this._shown = true;
        this._setOpacity(this.node, 255);

        // Подсказка видна
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
        if (this.progressRoot) {
            this.progressRoot.active = true;
            // База = позиция из редактора (под лого), не двигаем к машине
            this._barBasePos.set(this.progressRoot.position);
        }

        this._shakeOff.set(0, 0, 0);
        this._applyBarPos();
        this.setHp(1);

        this._pulsateLabel();
        this._animateHand();
    }

    /** Первый тап — сразу убрать фон, кулак и текст. HP остаётся. */
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
        if (this.progressRoot) this.progressRoot.active = false;
        this._stopHitVignette();

        if (!this._shown) {
            this.node.active = false;
            return;
        }
        this._shown = false;

        if (this.progressFill) Tween.stopAllByTarget(this.progressFill);
        Tween.stopAllByTarget(this._shakeProxy);

        this.node.active = false;
    }

    public setProgress(hits: number, total: number): void {
        const hp = total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - hits / total));
        this.setHp(hp);
    }

    /** hp 1 = полное, уменьшается слева направо (якорь слева). */
    public setHp(hp: number): void {
        this._ensureHpBar();
        if (!this.progressFill) return;
        const t = Math.min(1, Math.max(0, hp));
        Tween.stopAllByTarget(this.progressFill);
        tween(this.progressFill)
            .to(0.2, { scale: new Vec3(Math.max(0.001, t), 1, 1) }, { easing: 'sineOut' })
            .start();
    }

    public shakeBar(intensity: number = 22): void {
        if (!this.progressRoot?.isValid) return;
        // На случай если ноду подвинули в редакторе между ударами
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

    /**
     * Круговое затемнение при ударе:
     * темнота с краёв сжимается к центру → сразу обратно.
     */
    public pulseHitVignette(): void {
        this._ensureHitVignette();
        if (!this._hitVignette?.isValid || !this._hitVignetteOp) return;

        const n = this._hitVignette;
        const op = this._hitVignetteOp;
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(op);

        n.active = true;
        // Старт: виньетка «далеко» (тёмные только углы) + прозрачная
        n.setScale(1.65, 1.65, 1);
        op.opacity = 0;

        const peak = this.hitVignettePeakOpacity;
        // К центру: scale ↓ + opacity ↑  →  обратно
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

    /** Fullscreen radial vignette на Canvas (sibling hitcarui). */
    private _ensureHitVignette(): void {
        if (this._hitVignette?.isValid && this._hitVignetteOp?.isValid) return;

        const parent = this.node.parent ?? this.node;
        let n = parent.getChildByName('HitImpactVignette');
        if (!n) {
            n = new Node('HitImpactVignette');
            n.layer = Layers.Enum.UI_2D;
            parent.addChild(n);
            // Поверх hitcarui
            n.setSiblingIndex(parent.children.length - 1);

            const ut = n.addComponent(UITransform);
            const vs = view.getVisibleSize();
            // С запасом — при scale 1.0 всё равно кроет экран
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

    /** Чёрная виньетка: центр прозрачный, края непрозрачные. */
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
                // 0 в центре → 1 у краёв (с мягким порогом)
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

    /**
     * Использует progressRoot из Inspector.
     * Ширина/высота Fill = UITransform этой ноды.
     * Fill якорь слева → scale.x уменьшает бар только с правого края.
     */
    private _ensureHpBar(): void {
        if (!this.progressRoot?.isValid) {
            // Нет ноды — ничего не создаём (пользователь вешает ProgressBar сам)
            return;
        }

        // Убрать старый авто-Progress, если он был создан раньше
        const legacy = this.node.getChildByName('Progress');
        if (legacy && legacy !== this.progressRoot) {
            legacy.destroy();
        }

        const rootUt = this.progressRoot.getComponent(UITransform)
            ?? this.progressRoot.addComponent(UITransform);
        this._barW = Math.max(40, rootUt.contentSize.width || 400);
        this._barH = Math.max(8, rootUt.contentSize.height || 36);

        let fill = this.progressFill?.isValid
            ? this.progressFill
            : this.progressRoot.getChildByName('Fill');

        if (!fill) {
            fill = new Node('Fill');
            fill.layer = this.progressRoot.layer || Layers.Enum.UI_2D;
            this.progressRoot.addChild(fill);

            const fut = fill.addComponent(UITransform);
            fut.setContentSize(this._barW, this._barH);
            fut.setAnchorPoint(0, 0.5);

            // Левый край = левый край progressRoot (якорь root обычно 0.5)
            const rootAnchorX = rootUt.anchorX;
            const leftLocal = -this._barW * rootAnchorX;
            fill.setPosition(leftLocal, 0, 0);
            fill.setScale(1, 1, 1);

            const g = fill.addComponent(Graphics);
            g.clear();
            g.fillColor = new Color(230, 40, 40, 255);
            // Рисуем ВПРАВО от якоря (0,0) — иначе при scale визуально жмёт с двух сторон
            g.rect(0, -this._barH * 0.5, this._barW, this._barH);
            g.fill();
            this._fillGfx = g;
        } else {
            const fut = fill.getComponent(UITransform) ?? fill.addComponent(UITransform);
            fut.setContentSize(this._barW, this._barH);
            fut.setAnchorPoint(0, 0.5);
            const rootAnchorX = rootUt.anchorX;
            fill.setPosition(-this._barW * rootAnchorX, 0, 0);

            let g = fill.getComponent(Graphics);
            if (!g) g = fill.addComponent(Graphics);
            g.clear();
            g.fillColor = new Color(230, 40, 40, 255);
            g.rect(0, -this._barH * 0.5, this._barW, this._barH);
            g.fill();
            this._fillGfx = g;
        }

        this.progressFill = fill;

        // Тёмный трек на самой progressRoot, если нет Sprite
        let track = this.progressRoot.getChildByName('Track');
        if (!track) {
            track = new Node('Track');
            track.layer = this.progressRoot.layer || Layers.Enum.UI_2D;
            this.progressRoot.insertChild(track, 0);
            const tut = track.addComponent(UITransform);
            tut.setContentSize(this._barW, this._barH);
            tut.setAnchorPoint(0.5, 0.5);
            track.setPosition(0, 0, 0);
            const tg = track.addComponent(Graphics);
            tg.clear();
            tg.fillColor = new Color(25, 10, 10, 220);
            tg.rect(-this._barW * 0.5, -this._barH * 0.5, this._barW, this._barH);
            tg.fill();
        }
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

import { _decorator, Component, Node, tween, Tween, Vec3, UIOpacity, Label, input, Input, EventTouch, EventMouse } from 'cc';

const { ccclass, property } = _decorator;

/**
 * TapToPlay — после прогрева: "Tap to Play". До ready тапы игнорируются.
 */
@ccclass('TapToPlayController')
export class TapToPlayController extends Component {

    @property({ type: Node, tooltip: 'Панель "Tap to Play" (корневая нода с фоном)' })
    tapToPlayPanel: Node | null = null;

    @property({ type: Label, tooltip: 'Лейбл с текстом "Tap to Play"' })
    tapLabel: Label | null = null;

    @property({ type: Node, tooltip: 'Нода руки под текстом (анимируется тапающим жестом)' })
    handNode: Node | null = null;

    @property({ tooltip: 'Секунд на fade-out панели после тапа' })
    hideTime: number = 0.4;

    public onStartGame: (() => void) | null = null;

    private _waiting: boolean = true;
    private _ready: boolean = false;
    private _handBasePos = new Vec3();

    onLoad(): void {
        if (this.tapToPlayPanel) {
            this._setOpacity(this.tapToPlayPanel, 255);
            this.tapToPlayPanel.on(Node.EventType.TOUCH_START, this._onPanelTap, this);
            this.tapToPlayPanel.on(Node.EventType.MOUSE_DOWN, this._onPanelTap, this);
        }
        input.on(Input.EventType.TOUCH_START, this._onGlobalTap, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onGlobalTap, this);
        this._resolveHand();
    }

    /** false = идёт Loading/warmup, тапы не принимаем. */
    public setReady(ready: boolean): void {
        this._ready = ready;
    }

    public get isReady(): boolean {
        return this._ready;
    }

    onDestroy(): void {
        if (this.tapToPlayPanel?.isValid) {
            this.tapToPlayPanel.off(Node.EventType.TOUCH_START, this._onPanelTap, this);
            this.tapToPlayPanel.off(Node.EventType.MOUSE_DOWN, this._onPanelTap, this);
        }
        input.off(Input.EventType.TOUCH_START, this._onGlobalTap, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onGlobalTap, this);
    }

    start(): void {
        this._resolveHand();
        this._pulsateLabel();
        this._animateHand();
    }

    private _resolveHand(): void {
        if (this.handNode?.isValid) return;
        const root = this.tapToPlayPanel ?? this.node;
        this.handNode = root.getChildByName('FingerHint-001')
            ?? root.getChildByName('FingerHint')
            ?? root.getChildByName('hand')
            ?? root.getChildByName('Hand');
    }

    private _onPanelTap(event: EventTouch | EventMouse): void {
        event.propagationStopped = true;
        this._onTap();
    }

    private _onGlobalTap(event: EventTouch | EventMouse): void {
        if (!this._waiting) return;
        event.propagationStopped = true;
        this._onTap();
    }

    private _onTap(): void {
        if (!this._ready || !this._waiting) return;
        this._waiting = false;

        if (this.tapToPlayPanel) {
            this.tapToPlayPanel.off(Node.EventType.TOUCH_START, this._onPanelTap, this);
            this.tapToPlayPanel.off(Node.EventType.MOUSE_DOWN, this._onPanelTap, this);
        }
        input.off(Input.EventType.TOUCH_START, this._onGlobalTap, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onGlobalTap, this);
        if (this.tapLabel) Tween.stopAllByTarget(this.tapLabel.node);
        if (this.handNode) Tween.stopAllByTarget(this.handNode);

        this._fadeOut(this.tapToPlayPanel, this.hideTime, () => {
            if (this.tapToPlayPanel) this.tapToPlayPanel.active = false;
            if (this.onStartGame) this.onStartGame();
        });
    }

    private _pulsateLabel(): void {
        if (!this.tapLabel) return;
        const n = this.tapLabel.node;
        let op = n.getComponent(UIOpacity);
        if (!op) op = n.addComponent(UIOpacity);
        tween(op)
            .repeatForever(
                tween(op)
                    .to(0.7, { opacity: 255 }, { easing: 'sineOut' })
                    .to(0.7, { opacity: 80 }, { easing: 'sineIn' })
            )
            .start();
    }

    private _animateHand(): void {
        if (!this.handNode) return;
        const h = this.handNode;
        this._handBasePos.set(h.position);
        const basePos = this._handBasePos.clone();
        const baseScale = h.scale.clone();

        // Бесшовный loop: вверх ↔ вниз, sine, без пауз
        const up = new Vec3(basePos.x, basePos.y + 12, basePos.z);
        const down = new Vec3(basePos.x, basePos.y - 10, basePos.z);
        const scaleUp = new Vec3(baseScale.x * 1.06, baseScale.y * 1.06, baseScale.z);
        const scaleDown = new Vec3(baseScale.x * 0.96, baseScale.y * 0.96, baseScale.z);

        h.setPosition(down);
        h.setScale(scaleDown);
        Tween.stopAllByTarget(h);

        tween(h)
            .repeatForever(
                tween(h)
                    .to(0.55, { position: up, scale: scaleUp }, { easing: 'sineInOut' })
                    .to(0.55, { position: down, scale: scaleDown }, { easing: 'sineInOut' }),
            )
            .start();
    }

    private _setOpacity(node: Node, a: number): void {
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    private _fadeOut(node: Node | null, time: number, done?: () => void): void {
        if (!node) { done && done(); return; }
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        tween(op)
            .to(time, { opacity: 0 })
            .call(() => { done && done(); })
            .start();
    }
}

import { _decorator, Component, Node, tween, Tween, Vec3, UIOpacity, Label, input, Input, EventTouch, EventMouse } from 'cc';

const { ccclass, property } = _decorator;

/**
 * TapToPlayController
 * Показывает экран "Tap to Play" перед стартом геймплея.
 * При первом касании: анимировано скрывает экран и вызывает onStartGame().
 *
 * Привязки в Inspector (всё внутри Canvas):
 *   tapToPlayPanel — корневая нода экрана (содержит фон + текст "Tap to Play")
 *   tapLabel       — Label с текстом (пульсирует)
 *   handNode       — нода руки (анимируется тапающим жестом под текстом)
 *
 * Пока панель видна — игра НЕ стартует.
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

    /** Вызывается когда игрок тапнул и экран скрыт — запускает геймплей. */
    public onStartGame: (() => void) | null = null;

    private _waiting: boolean = true;

    onLoad(): void {
        if (this.tapToPlayPanel) {
            this._setOpacity(this.tapToPlayPanel, 255);
            this.tapToPlayPanel.on(Node.EventType.TOUCH_START, this._onPanelTap, this);
            this.tapToPlayPanel.on(Node.EventType.MOUSE_DOWN, this._onPanelTap, this);
        }
        // На десктопе TOUCH_START на UI иногда не приходит — ловим глобальный клик.
        input.on(Input.EventType.TOUCH_START, this._onGlobalTap, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onGlobalTap, this);
        // Если handNode не назначен в Inspector — пробуем найти дочернюю ноду "hand"
        if (!this.handNode && this.tapToPlayPanel) {
            this.handNode = this.tapToPlayPanel.getChildByName('hand');
        }
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
        // Пульсирование лейбла "Tap to Play"
        this._pulsateLabel();
        // Анимация руки — тапающий жест
        this._animateHand();
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
        if (!this._waiting) return;
        this._waiting = false;

        if (this.tapToPlayPanel) {
            this.tapToPlayPanel.off(Node.EventType.TOUCH_START, this._onPanelTap, this);
            this.tapToPlayPanel.off(Node.EventType.MOUSE_DOWN, this._onPanelTap, this);
        }
        input.off(Input.EventType.TOUCH_START, this._onGlobalTap, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onGlobalTap, this);
        if (this.tapLabel) {
            tween(this.tapLabel.node).stop();
        }
        if (this.handNode) {
            Tween.stopAllByTarget(this.handNode);
        }

        // Fade out панели
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

    /**
     * Анимация руки — пульсирующий scale 1→1.2→1, синхронизирован с пульсом лейбла.
     */
    private _animateHand(): void {
        if (!this.handNode) return;
        const h = this.handNode;
        h.setScale(1, 1, 1);
        tween(h)
            .repeatForever(
                tween(h)
                    .to(0.7, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'sineOut' })
                    .to(0.7, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'sineIn' })
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

import { _decorator, Component, Node, UIOpacity, tween, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * PersistentUI
 * Логотип и кнопка Play Now всегда видны поверх всего геймплея.
 * Скрываются только в финальном EndCard (вызов hide()).
 *
 * Привязки в Inspector:
 *   logo          — нода с логотипом
 *   playNowButton — нода кнопки Play Now
 */
@ccclass('PersistentUI')
export class PersistentUI extends Component {
    @property(Node)
    logo: Node | null = null;

    @property(Node)
    playNowButton: Node | null = null;

    public onPlayNow: (() => void) | null = null;

    private _hidden: boolean = false;

    onLoad(): void {
        // Убедимся что видны с самого начала
        this._setOpacity(this.logo, 255);
        this._setOpacity(this.playNowButton, 255);

        if (this.playNowButton) {
            this.playNowButton.on(Node.EventType.TOUCH_START, this._onTap, this);
        }
        if (this.logo) {
            this.logo.on(Node.EventType.TOUCH_START, this._onTap, this);
        }

        // Лёгкая пульсация кнопки Play Now
        this._pulsateButton();
    }

    private _onTap(): void {
        if (this.onPlayNow) this.onPlayNow();
    }

    /** Скрыть PersistentUI перед EndCard. */
    public hide(): void {
        if (this._hidden) return;
        this._hidden = true;
        this._fadeTo(this.logo, 0, 0.4);
        this._fadeTo(this.playNowButton, 0, 0.4);
    }

    /** Показать снова (если нужно сбросить состояние). */
    public show(): void {
        this._hidden = false;
        this._fadeTo(this.logo, 255, 0.3);
        this._fadeTo(this.playNowButton, 255, 0.3);
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    private _pulsateButton(): void {
        if (!this.playNowButton) return;
        tween(this.playNowButton)
            .repeatForever(
                tween(this.playNowButton)
                    .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineOut' })
                    .to(0.8, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'sineIn' })
            )
            .start();
    }

    private _setOpacity(node: Node | null, a: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    private _fadeTo(node: Node | null, to: number, time: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        tween(op).to(time, { opacity: to }).start();
    }
}

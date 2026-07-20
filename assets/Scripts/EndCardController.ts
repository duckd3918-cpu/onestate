import { _decorator, Component, Node, tween, Vec3, UIOpacity, Label } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('EndCardController')
export class EndCardController extends Component {
    @property(Node)
    logo: Node | null = null;

    @property(Node)
    officerPortrait: Node | null = null;

    @property(Label)
    tagline: Label | null = null;

    @property(Node)
    playNowButton: Node | null = null;

    @property({ tooltip: 'Seconds fade-in for logo' })
    fadeInTime: number = 0.6;

    public onPlayNow: (() => void) | null = null;

    private _btnScale = new Vec3(1, 1, 1);

    onLoad(): void {
        if (this.playNowButton) {
            this._btnScale = this.playNowButton.scale.clone();
            this.playNowButton.setScale(0, 0, 0);
            this.playNowButton.on(Node.EventType.TOUCH_START, this.onAnyTap, this);
        }
        this.setOpacity(this.logo, 0);
        this.setOpacity(this.officerPortrait, 0);
        if (this.tagline) this.setOpacity(this.tagline.node, 0);
        // Корень (лого-спрайт) гасим — появится поверх чёрного фона
        this.setOpacity(this.node, 0);

        this.node.on(Node.EventType.TOUCH_START, this.onAnyTap, this);
    }

    public show(): void {
        this._fadeOpacity(this.node, 255, Math.max(0.8, this.fadeInTime + 0.3));

        if (this.officerPortrait) {
            this._fadeOpacity(this.officerPortrait, 255, this.fadeInTime);
        }
        this.scheduleOnce(() => {
            if (this.logo) this._fadeOpacity(this.logo, 255, this.fadeInTime);
        }, 0.2);
        this.scheduleOnce(() => {
            if (this.tagline) this._fadeOpacity(this.tagline.node, 255, 0.4);
        }, 0.5);
        this.scheduleOnce(() => {
            if (!this.playNowButton) return;
            const s = this._btnScale;
            tween(this.playNowButton)
                .to(0.4, { scale: new Vec3(s.x, s.y, s.z) }, { easing: 'backOut' })
                .start();
            this.loopButtonBounce();
        }, 0.75);
    }

    private loopButtonBounce(): void {
        if (!this.playNowButton) return;
        const s = this._btnScale;
        this.scheduleOnce(() => {
            tween(this.playNowButton)
                .to(0.5, { scale: new Vec3(s.x * 1.06, s.y * 1.06, s.z) }, { easing: 'sineOut' })
                .to(0.5, { scale: new Vec3(s.x, s.y, s.z) }, { easing: 'sineIn' })
                .start();
            this.loopButtonBounce();
        }, 1.0);
    }

    private onAnyTap(): void {
        if (this.onPlayNow) this.onPlayNow();
    }

    private setOpacity(node: Node | null, a: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    private _fadeOpacity(node: Node | null, to: number, time: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        tween(op).to(time, { opacity: to }, { easing: 'sineOut' }).start();
    }
}

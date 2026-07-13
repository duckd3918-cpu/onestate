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

    onLoad(): void {
        this.setOpacity(this.logo, 0);
        this.setOpacity(this.officerPortrait, 0);
        if (this.tagline) this.setOpacity(this.tagline.node, 0);
        if (this.playNowButton) this.playNowButton.setScale(0, 0, 0);
        this.node.on(Node.EventType.TOUCH_START, this.onAnyTap, this);
        if (this.playNowButton) this.playNowButton.on(Node.EventType.TOUCH_START, this.onAnyTap, this);
    }

    public show(): void {
        if (this.officerPortrait) {
            tween(this.officerPortrait).to(this.fadeInTime, {}, { onUpdate: () => this.setOpacity(this.officerPortrait, 255) }).start();
        }
        this.scheduleOnce(() => {
            if (this.logo) tween(this.logo).to(this.fadeInTime, {}, { onUpdate: () => this.setOpacity(this.logo, 255) }).start();
        }, 0.3);
        this.scheduleOnce(() => {
            if (this.tagline) tween(this.tagline.node).to(0.4, {}, { onUpdate: () => this.setOpacity(this.tagline.node, 255) }).start();
        }, 0.7);
        this.scheduleOnce(() => {
            if (this.playNowButton) {
                tween(this.playNowButton)
                    .to(0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
                    .start();
                this.loopButtonBounce();
            }
        }, 1.0);
    }

    private loopButtonBounce(): void {
        if (!this.playNowButton) return;
        this.scheduleOnce(() => {
            tween(this.playNowButton)
                .to(0.5, { scale: new Vec3(1.06, 1.06, 1) }, { easing: 'sineOut' })
                .to(0.5, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
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
}

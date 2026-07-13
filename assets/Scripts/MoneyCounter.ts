import { _decorator, Component, Node, Label, tween, Vec3, UIOpacity } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('MoneyCounter')
export class MoneyCounter extends Component {
    @property(Label)
    label: Label | null = null;

    @property({ tooltip: 'Count-up seconds' })
    duration: number = 1.6;

    @property({ tooltip: 'Bounce scale at the final number' })
    bounceScale: number = 1.35;

    public play(target: number): void {
        if (!this.label) return;
        this.label.string = '$0';
        const start = Date.now();
        const ms = this.duration * 1000;
        const tick = () => {
            const t = Math.min(1, (Date.now() - start) / ms);
            const eased = 1 - Math.pow(1 - t, 3);
            const val = Math.round(target * eased);
            if (this.label) this.label.string = '$' + val.toLocaleString();
            if (t < 1) {
                this.scheduleOnce(tick, 0.03);
            } else {
                this.bounce();
            }
        };
        tick();
    }

    private bounce(): void {
        if (!this.label) return;
        const node = this.label.node;
        tween(node)
            .to(0.18, { scale: new Vec3(this.bounceScale, this.bounceScale, 1) }, { easing: 'backOut' })
            .to(0.22, { scale: new Vec3(1, 1, 1) }, { easing: 'backIn' })
            .start();
    }
}

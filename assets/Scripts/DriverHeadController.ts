import { _decorator, Component, Node, tween, Tween, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * DriverHeadController — поворачивает ноду JohnHead целиком (как изначально).
 */
@ccclass('DriverHeadController')
export class DriverHeadController extends Component {
    @property({ type: Node, tooltip: 'JohnHead — корневая нода головы' })
    headBone: Node | null = null;

    @property({ tooltip: 'Угол поворота по Y (градусы). Положительный = налево.' })
    lookAtAngleY: number = 45;

    @property({ tooltip: 'Лёгкий наклон вниз по X (градусы)' })
    tiltAngleX: number = 5;

    @property({ tooltip: 'Секунд на поворот' })
    turnDuration: number = 0.8;

    @property
    easing: string = 'sineInOut';

    public onTurnComplete: (() => void) | null = null;

    private _neutralEuler: Vec3 = new Vec3();
    private _turned: boolean = false;

    onLoad(): void {
        if (this.headBone) {
            this._neutralEuler = this.headBone.eulerAngles.clone();
        }
    }

    public turnToOfficer(): void {
        if (this._turned || !this.headBone) {
            if (this.onTurnComplete) this.onTurnComplete();
            return;
        }
        this._turned = true;

        const neutral = this._neutralEuler.clone();
        const turned = new Vec3(
            neutral.x + this.tiltAngleX,
            neutral.y + this.lookAtAngleY,
            neutral.z,
        );

        tween(this.headBone)
            .to(this.turnDuration, { eulerAngles: turned }, { easing: this.easing as any })
            .call(() => { if (this.onTurnComplete) this.onTurnComplete(); })
            .start();
    }

    public resetHead(duration: number = 0.3): void {
        if (!this.headBone) return;
        Tween.stopAllByTarget(this.headBone);
        tween(this.headBone)
            .to(duration, { eulerAngles: this._neutralEuler.clone() }, { easing: 'sineInOut' })
            .start();
        this._turned = false;
    }
}

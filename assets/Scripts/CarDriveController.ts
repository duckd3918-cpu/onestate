import { _decorator, Component, Node, tween, Tween, Vec3, Quat } from 'cc';

const { ccclass, property } = _decorator;

/**
 * CarDriveController — езда + вращение колёс (Wheel_lod0*).
 */
@ccclass('CarDriveController')
export class CarDriveController extends Component {
    @property({ type: Node, tooltip: 'Wheel_FL — передняя левая' })
    wheelFL: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_FR — передняя правая' })
    wheelFR: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_RL — задняя левая' })
    wheelRL: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_RR — задняя правая' })
    wheelRR: Node | null = null;

    @property({ type: Node, tooltip: 'Единый задний цилиндр-ось' })
    wheelRearSingle: Node | null = null;

    @property({ tooltip: 'Расстояние езды' })
    driveDistance: number = 7;

    @property({ tooltip: 'Длительность езды (сек)' })
    driveDuration: number = 3.5;

    @property({ tooltip: 'Ось: 0=X, 1=Y, 2=Z' })
    driveAxis: number = 2;

    @property({ tooltip: 'Направление: 1 или -1' })
    driveSign: number = -1;

    @property({ tooltip: 'Радиус колеса' })
    wheelRadius: number = 0.32;

    @property({ tooltip: 'Крутить колёса во время езды' })
    spinWheels: boolean = true;

    private _driving = false;
    private _startPos: Vec3 = new Vec3();
    private _endPos: Vec3 = new Vec3();
    private _wheels: Node[] = [];
    private _wheelAngles: number[] = [];
    private _wheelBaseRot: Quat[] = [];
    private _tmpQuat: Quat = new Quat();
    private _spinQuat: Quat = new Quat();
    private _driveTween: Tween<{ t: number }> | null = null;
    private _driveProxy: { t: number } = { t: 0 };
    private _degPerSec = 0;
    private _movePos: Vec3 = new Vec3();

    public onStopped: (() => void) | null = null;

    onLoad(): void {
        this._buildWheelList();
    }

    public warmUp(): void {
        if (this._wheels.length === 0) this._buildWheelList();
    }

    private _buildWheelList(): void {
        this._wheels.length = 0;

        const namedPairs: [Node | null, string][] = [
            [this.wheelFL, 'Wheel_FL'],
            [this.wheelFR, 'Wheel_FR'],
            [this.wheelRL, 'Wheel_RL'],
            [this.wheelRR, 'Wheel_RR'],
        ];
        for (const [ref, name] of namedPairs) {
            const w = ref ?? this.node.getChildByName(name);
            if (w && this._wheels.indexOf(w) < 0) this._wheels.push(w);
        }

        const collect = (n: Node) => {
            const nm = n.name || '';
            if (nm === 'Wheel_lod0' || nm.startsWith('Wheel_lod0.')) {
                if (this._wheels.indexOf(n) < 0) this._wheels.push(n);
            }
            for (const c of n.children) collect(c);
        };
        collect(this.node);

        if (this.wheelRearSingle && this._wheels.indexOf(this.wheelRearSingle) < 0) {
            this._wheels.push(this.wheelRearSingle);
        }

        this._wheelAngles = this._wheels.map(() => 0);
        this._wheelBaseRot = this._wheels.map(w => w.rotation.clone());
    }

    public startDrive(): void {
        if (this._driving) return;
        if (this._wheels.length === 0) this._buildWheelList();

        this._driving = true;
        this._startPos.set(this.node.position);
        this._endPos.set(this._startPos);
        const delta = this.driveDistance * this.driveSign;
        if (this.driveAxis === 0) this._endPos.x += delta;
        else if (this.driveAxis === 1) this._endPos.y += delta;
        else this._endPos.z += delta;

        const speed = this.driveDistance / Math.max(0.01, this.driveDuration);
        this._degPerSec = (speed / this.wheelRadius) * (180 / Math.PI);

        this._driveProxy.t = 0;
        this._driveTween = tween(this._driveProxy)
            .to(this.driveDuration, { t: 1 }, {
                easing: 'quadOut',
                onUpdate: () => {
                    Vec3.lerp(this._movePos, this._startPos, this._endPos, this._driveProxy.t);
                    this.node.setPosition(this._movePos);
                },
            })
            .call(() => {
                this._driving = false;
                this.node.setPosition(this._endPos);
                if (this.onStopped) this.onStopped();
            })
            .start();
    }

    public stopDrive(): void {
        if (this._driveTween) {
            this._driveTween.stop();
            this._driveTween = null;
        }
        this._driving = false;
    }

    update(dt: number): void {
        if (!this._driving || !this.spinWheels || this._wheels.length === 0) return;

        // Каждый кадр — иначе на mobile шины «рубятся» / выглядят низкополигонально
        const step = this._degPerSec * dt * (-this.driveSign);
        for (let i = 0; i < this._wheels.length; i++) {
            this._wheelAngles[i] += step;
            Quat.fromEuler(this._spinQuat, this._wheelAngles[i], 0, 0);
            Quat.multiply(this._tmpQuat, this._wheelBaseRot[i], this._spinQuat);
            this._wheels[i].setRotation(this._tmpQuat);
        }
    }
}

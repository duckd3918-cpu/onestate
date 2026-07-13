import { _decorator, Component, Node, tween, Tween, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * CarDriveController
 * Вешается на корневую ноду машины игрока.
 *
 * Иерархия нод, которую ожидает скрипт:
 *   PlayerCar (этот компонент)
 *     ├── Wheel_FL   (передняя левая)
 *     ├── Wheel_FR   (передняя правая)
 *     ├── Wheel_RL   (задняя левая)  — может быть null если одна общая ось
 *     ├── Wheel_RR   (задняя правая) — может быть null если одна общая ось
 *     └── Wheel_Rear (единый задний цилиндр, если колёса не разделены)
 *
 * Если имена колёс отличаются — перетащи ноды вручную в поля в Inspector.
 * Колёса вращаются вокруг локальной оси X.
 * Машина едет по оси Z (можно изменить через driveAxis).
 *
 * Bug fix: задний цилиндр (единая нода Wheel_Rear) теперь тоже вращается.
 * Bug fix: колёса перестают крутиться сразу после остановки машины.
 */
@ccclass('CarDriveController')
export class CarDriveController extends Component {
    // ── Колёса ────────────────────────────────────────────────────────────
    @property({ type: Node, tooltip: 'Wheel_FL — передняя левая' })
    wheelFL: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_FR — передняя правая' })
    wheelFR: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_RL — задняя левая (или null если одна общая ось)' })
    wheelRL: Node | null = null;
    @property({ type: Node, tooltip: 'Wheel_RR — задняя правая (или null если одна общая ось)' })
    wheelRR: Node | null = null;

    @property({ type: Node, tooltip: 'Единый задний цилиндр-ось (если нет отдельных задних колёс)' })
    wheelRearSingle: Node | null = null;

    // ── Параметры движения ────────────────────────────────────────────────
    @property({ tooltip: 'Расстояние, которое проедет машина (мировые единицы)' })
    driveDistance: number = 7;

    @property({ tooltip: 'Длительность езды (сек)' })
    driveDuration: number = 3.5;

    @property({ tooltip: 'Ось движения: 0=X, 1=Y, 2=Z' })
    driveAxis: number = 2;

    @property({ tooltip: 'Направление: 1 или -1' })
    driveSign: number = -1;

    @property({ tooltip: 'Радиус колеса (мировые единицы) для расчёта скорости вращения' })
    wheelRadius: number = 0.32;

    // ── Приватные поля ────────────────────────────────────────────────────
    private _driving: boolean = false;
    private _startPos: Vec3 = new Vec3();
    private _wheels: Node[] = [];
    private _wheelAngles: number[] = [];
    private _wheelEulerY: number[] = [];
    private _wheelEulerZ: number[] = [];
    private _driveTween: Tween<Node> | null = null;

    // ── Публичный callback: вызывается когда машина остановилась ─────────
    public onStopped: (() => void) | null = null;

    onLoad(): void {
        this._buildWheelList();
    }

    private _buildWheelList(): void {
        // Явно привязанные или найденные по именам
        const namedPairs: [Node | null, string][] = [
            [this.wheelFL, 'Wheel_FL'],
            [this.wheelFR, 'Wheel_FR'],
            [this.wheelRL, 'Wheel_RL'],
            [this.wheelRR, 'Wheel_RR'],
        ];

        this._wheels = [];

        for (const [ref, name] of namedPairs) {
            const w = ref ?? this.node.getChildByName(name);
            if (w) this._wheels.push(w);
        }

        // Единый задний цилиндр: привязан вручную или ищем по типичным именам
        const rearNames = ['Wheel_Rear', 'wheel_rear', 'WheelRear', 'Rear_Wheel',
                           'rear_wheel', 'BackWheel', 'back_wheel',
                           // Bandit car специфичные имена
                           'wheel_back', 'Wheel_Back', 'wheels_back', 'Wheels_Back',
                           'cylinder', 'Cylinder', 'axle', 'Axle'];
        let rearSingle = this.wheelRearSingle;
        if (!rearSingle) {
            for (const name of rearNames) {
                rearSingle = this.node.getChildByName(name);
                if (rearSingle) break;
            }
        }
        if (rearSingle && this._wheels.indexOf(rearSingle) === -1) {
            this._wheels.push(rearSingle);
        }

        this._wheelAngles = this._wheels.map(() => 0);
        // Кэшируем Y/Z — иначе каждый кадр читаем eulerAngles (дорого на большой иерархии)
        this._wheelEulerY = this._wheels.map(w => w.eulerAngles.y);
        this._wheelEulerZ = this._wheels.map(w => w.eulerAngles.z);
    }

    /**
     * Запустить: машина начинает ехать и останавливается через driveDuration.
     */
    public startDrive(): void {
        if (this._driving) return;

        // Перестроим список колёс (на случай если ноды не были готовы в onLoad)
        if (this._wheels.length === 0) this._buildWheelList();

        this._driving = true;
        this._startPos = this.node.position.clone();

        const endPos = this._startPos.clone();
        const delta = this.driveDistance * this.driveSign;
        if (this.driveAxis === 0) endPos.x += delta;
        else if (this.driveAxis === 1) endPos.y += delta;
        else endPos.z += delta;

        this._driveTween = tween(this.node)
            .to(this.driveDuration, { position: endPos }, { easing: 'sineOut' })
            .call(() => {
                // Bug fix 3: сразу останавливаем вращение колёс
                this._driving = false;
                if (this.onStopped) this.onStopped();
            })
            .start();
    }

    /**
     * Жёсткая немедленная остановка.
     */
    public stopDrive(): void {
        if (this._driveTween) {
            this._driveTween.stop();
            this._driveTween = null;
        }
        this._driving = false;
    }

    update(dt: number): void {
        // Bug fix 3: обновляем углы ТОЛЬКО пока _driving = true
        if (!this._driving || this._wheels.length === 0) return;

        // Средняя скорость (м/с)
        const speed = this.driveDistance / this.driveDuration;
        // угловая скорость: ω = v / r → °/с
        const degPerSec = (speed / this.wheelRadius) * (180 / Math.PI);

        for (let i = 0; i < this._wheels.length; i++) {
            this._wheelAngles[i] += degPerSec * dt * this.driveSign;
            this._wheels[i].setRotationFromEuler(
                this._wheelAngles[i],
                this._wheelEulerY[i],
                this._wheelEulerZ[i],
            );
        }
    }
}

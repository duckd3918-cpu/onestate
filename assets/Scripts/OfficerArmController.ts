import { _decorator, Component, Node, tween, Tween, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * OfficerArmController
 * Вешается на ноду офицера (или на любую родительскую ноду).
 *
 * Управляет ОДНОЙ нодой-рукой (правая рука — жест STOP).
 * Нода OfficerRightArm должна быть дочерней по отношению к туловищу/офицеру
 * с pivot в точке плеча, чтобы вращение выглядело правдоподобно.
 *
 * Если у тебя скелетная кость — найди её в Hierarchy внутри FBX-инстанса
 * (Cocos разворачивает скелет как дочерние ноды) и перетащи в поле rightArmBone.
 *
 * Типичные имена костей в FBX-экспорте из Maya/Blender:
 *   mixamorig:RightArm / Bip001 R UpperArm / upperarm_r
 * Раскрой в Hierarchy → Characters → Officer → Armature → ... и найди нужную.
 *
 * Timeline офицера:
 *   0.0s  – поднять руку вверх (жест «стоп») за 0.4 сек
 *   0.4s  – держать руку поднятой (holdDuration сек)
 *   0.4+hold – опустить руку обратно за 0.5 сек → callback onGestureComplete
 */
@ccclass('OfficerArmController')
export class OfficerArmController extends Component {
    @property({ type: Node, tooltip: 'Нода правой руки/кости плеча офицера' })
    rightArmBone: Node | null = null;

    @property({ type: Node, tooltip: '(опционально) Нода предплечья — уточняет жест' })
    rightForearmBone: Node | null = null;

    @property({ tooltip: 'Угол подъёма руки по оси Z в локальных координатах (обычно 80–100°)' })
    raiseAngleZ: number = 90;

    @property({ tooltip: 'Начальный угол руки (опущена вдоль тела)' })
    restAngleZ: number = 0;

    @property({ tooltip: 'Дополнительный наклон предплечья (ладонь "вперёд", ось X)' })
    forearmAngleX: number = -30;

    @property({ tooltip: 'Секунд держать руку поднятой' })
    holdDuration: number = 1.5;

    @property({ tooltip: 'Скорость подъёма руки (сек). Увеличь до 0.9-1.2 для натуральности.' })
    raiseDuration: number = 0.9;

    @property({ tooltip: 'Скорость опускания руки (сек)' })
    lowerDuration: number = 0.8;

    /** Вызывается по завершению жеста (рука опущена). */
    public onGestureComplete: (() => void) | null = null;

    private _restEuler: Vec3 = new Vec3();
    private _restForearmEuler: Vec3 = new Vec3();

    onLoad(): void {
        if (this.rightArmBone) {
            this._restEuler = this.rightArmBone.eulerAngles.clone();
        }
        if (this.rightForearmBone) {
            this._restForearmEuler = this.rightForearmBone.eulerAngles.clone();
        }
    }

    /**
     * Запустить жест. Вызывается из GameFlowController в нужный момент интро.
     */
    public playStopGesture(): void {
        if (!this.rightArmBone) {
            // Нет ноды — сразу callback
            if (this.onGestureComplete) this.onGestureComplete();
            return;
        }

        const restEuler = this._restEuler.clone();
        const raisedEuler = new Vec3(
            restEuler.x,
            restEuler.y,
            restEuler.z + this.raiseAngleZ,
        );

        // Последовательность: подъём → пауза → опускание
        tween(this.rightArmBone)
            .to(this.raiseDuration, { eulerAngles: raisedEuler }, { easing: 'sineOut' })
            .delay(this.holdDuration)
            .to(this.lowerDuration, { eulerAngles: restEuler }, { easing: 'sineInOut' })
            .call(() => { if (this.onGestureComplete) this.onGestureComplete(); })
            .start();

        // Если есть предплечье — параллельный tween: ладонь «вперёд»
        if (this.rightForearmBone) {
            const restFA = this._restForearmEuler.clone();
            const raisedFA = new Vec3(
                restFA.x + this.forearmAngleX,
                restFA.y,
                restFA.z,
            );
            tween(this.rightForearmBone)
                .to(this.raiseDuration, { eulerAngles: raisedFA }, { easing: 'sineOut' })
                .delay(this.holdDuration)
                .to(this.lowerDuration, { eulerAngles: restFA }, { easing: 'sineInOut' })
                .start();
        }
    }

    /**
     * Немедленно вернуть в позу покоя (если нужно сбросить анимацию).
     */
    public resetPose(): void {
        if (this.rightArmBone) {
            Tween.stopAllByTarget(this.rightArmBone);
            this.rightArmBone.setRotationFromEuler(
                this._restEuler.x, this._restEuler.y, this._restEuler.z
            );
        }
        if (this.rightForearmBone) {
            Tween.stopAllByTarget(this.rightForearmBone);
            this.rightForearmBone.setRotationFromEuler(
                this._restForearmEuler.x, this._restForearmEuler.y, this._restForearmEuler.z
            );
        }
    }
}

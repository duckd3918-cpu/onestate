import { _decorator, Component, Node, PointLight, director } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Мигание red/blue PointLight на полицейской машине.
 * Старт — вместе с WANTED / сиреной; мигает до конца playable.
 *
 * Ищет ноды `blueflasher` / `redflasher` по имени, если не заданы в Inspector.
 */
@ccclass('SirenFlasher')
export class SirenFlasher extends Component {

    @property({ type: Node, tooltip: 'Нода blueflasher (PointLight)' })
    blueFlasher: Node | null = null;

    @property({ type: Node, tooltip: 'Нода redflasher (PointLight)' })
    redFlasher: Node | null = null;

    @property({ tooltip: 'Полный цикл мигания одной лампы (сек)' })
    flashPeriod: number = 0.28;

    @property({ tooltip: 'Выключить оба огня до старта WANTED' })
    disableUntilWanted: boolean = true;

    private _blue: PointLight | null = null;
    private _red: PointLight | null = null;
    private _blueBase = 0;
    private _redBase = 0;
    private _flashing = false;
    private _t = 0;

    onLoad(): void {
        this._resolve();
        if (this.disableUntilWanted) this._setBoth(false);
    }

    public startFlashing(): void {
        this._resolve();
        if (!this._blue && !this._red) {
            console.warn('[SirenFlasher] no blueflasher/redflasher lights found');
            return;
        }
        this._flashing = true;
        this._t = 0;
        this._setBoth(true);
    }

    public stopFlashing(): void {
        this._flashing = false;
        this._setBoth(false);
    }

    update(dt: number): void {
        if (!this._flashing) return;
        this._t += dt;

        const half = Math.max(0.05, this.flashPeriod);
        // Синий и красный в противофазе
        const blueOn = Math.floor(this._t / half) % 2 === 0;
        if (this._blue) {
            this._blue.enabled = blueOn;
            this._blue.luminance = blueOn ? this._blueBase : 0;
        }
        if (this._red) {
            this._red.enabled = !blueOn;
            this._red.luminance = !blueOn ? this._redBase : 0;
        }
    }

    private _resolve(): void {
        if (!this.blueFlasher || !this.redFlasher) {
            const scene = director.getScene();
            if (scene) {
                if (!this.blueFlasher) this.blueFlasher = this._findByName(scene, 'blueflasher');
                if (!this.redFlasher) this.redFlasher = this._findByName(scene, 'redflasher');
            }
        }
        if (this.blueFlasher && !this._blue) {
            this._blue = this.blueFlasher.getComponent(PointLight);
            if (this._blue) this._blueBase = this._blue.luminance || 134;
        }
        if (this.redFlasher && !this._red) {
            this._red = this.redFlasher.getComponent(PointLight);
            if (this._red) this._redBase = this._red.luminance || 134;
        }
    }

    private _setBoth(on: boolean): void {
        if (this._blue) {
            this._blue.enabled = on;
            this._blue.luminance = on ? this._blueBase : 0;
        }
        if (this._red) {
            this._red.enabled = on;
            this._red.luminance = on ? this._redBase : 0;
        }
    }

    private _findByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const c of root.children) {
            const found = this._findByName(c, name);
            if (found) return found;
        }
        return null;
    }
}

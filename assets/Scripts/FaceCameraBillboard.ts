import {
    _decorator, Component, Node, director, Camera, Quat,
} from 'cc';

const { ccclass } = _decorator;

/** Копирует world-rotation камеры — квад всегда лицом к зрителю. */
@ccclass('FaceCameraBillboard')
export class FaceCameraBillboard extends Component {
    private _cam: Node | null = null;
    private readonly _worldRot = new Quat();

    onEnable(): void {
        this._resolveCam();
    }

    update(): void {
        if (!this._cam?.isValid) this._resolveCam();
        if (!this._cam?.isValid) return;
        this._cam.getWorldRotation(this._worldRot);
        this.node.setWorldRotation(this._worldRot);
    }

    private _resolveCam(): void {
        const scene = director.getScene();
        if (!scene) return;
        const cams = scene.getComponentsInChildren(Camera);
        for (const c of cams) {
            if (c.enabled && c.node.activeInHierarchy) {
                this._cam = c.node;
                return;
            }
        }
        this._cam = cams[0]?.node ?? null;
    }
}

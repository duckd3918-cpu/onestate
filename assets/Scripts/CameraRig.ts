import { _decorator, Component, Node, Camera, screen, view, Size, Vec3, Quat } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('CameraRig')
export class CameraRig extends Component {
    @property(Camera)
    camera: Camera | null = null;

    @property(Node)
    cameraNode: Node | null = null;

    @property({ tooltip: 'FOV for portrait (taller frame)' })
    portraitFov: number = 45;
    @property({ tooltip: 'FOV for landscape (wider frame)' })
    landscapeFov: number = 55;

    @property(Vec3)
    portraitPos: Vec3 = new Vec3(0, 3.5, 10);
    @property(Vec3)
    landscapePos: Vec3 = new Vec3(0, 4, 12);

    /** Euler angles (degrees) for portrait mode camera rotation. */
    @property(Vec3)
    portraitRot: Vec3 = new Vec3(-15, 0, 0);

    /** Euler angles (degrees) for landscape mode camera rotation. */
    @property(Vec3)
    landscapeRot: Vec3 = new Vec3(-12, 0, 0);

    @property({ tooltip: 'Smooth transition seconds on rotate (только если adjustPoseOnOrient)' })
    transitionTime: number = 0.4;

    /**
     * false (по умолчанию) — на повороте экрана меняется только FOV.
     * Иначе cinematic-поза (Intro / Arrest) слетает на landscapePos.
     */
    @property({ tooltip: 'Двигать позицию/поворот камеры при смене ориентации (обычно выкл.)' })
    adjustPoseOnOrient: boolean = false;

    private isPortrait: boolean = true;
    private _poseLocked: boolean = false;

    onLoad(): void {
        if (!this.camera && this.cameraNode) this.camera = this.cameraNode.getComponent(Camera);

        // Инициализируем portrait-значения из текущей позиции/поворота ноды в сцене
        if (this.cameraNode) {
            this.portraitPos = this.cameraNode.position.clone();
            const euler = new Vec3();
            Quat.toEuler(euler, this.cameraNode.rotation);
            this.portraitRot = euler;
        }

        try {
            screen.on('window-resize', this.onScreenResize, this);
        } catch (_) {
            (screen as any).onResize = this.onScreenResize.bind(this);
        }
    }

    private onScreenResize(): void {
        this.applyOrientation(true);
    }

    /** Запретить смену позиции/поворота (FOV по ориентации остаётся). */
    public lockPose(): void {
        this._poseLocked = true;
    }

    public unlockPose(): void {
        this._poseLocked = false;
    }

    public applyOrientation(animated: boolean = true): void {
        const size: Size = view.getVisibleSize();
        const portrait = size.height >= size.width;
        this.isPortrait = portrait;
        const fov = portrait ? this.portraitFov : this.landscapeFov;

        if (this.camera) this.camera.fov = fov;

        // Позу не трогаем: иначе landscape «прыгает» камеру во время playable
        if (this._poseLocked || !this.adjustPoseOnOrient || !this.cameraNode) return;

        const pos = portrait ? this.portraitPos : this.landscapePos;
        const rot = portrait ? this.portraitRot : this.landscapeRot;
        // animated оставлен для совместимости API; tween убран — резкий jump тоже нежелателен
        void animated;
        this.cameraNode.setPosition(pos.x, pos.y, pos.z);
        this.cameraNode.setRotationFromEuler(rot.x, rot.y, rot.z);
    }

    onDestroy(): void {
        try {
            screen.off('window-resize', this.onScreenResize, this);
        } catch (_) { }
    }
}

import {
    _decorator, Component, Node, MeshRenderer, SkinnedMeshRenderer,
    SkeletalAnimation, DirectionalLight, director, Vec3, Renderer, Camera,
} from 'cc';
import { BanditSwap } from './BanditSwap';

const { ccclass } = _decorator;

/**
 * Prep + warmup на Tap to Play.
 * Персонажи всегда на lod0 (LODGroup выкл) — без «страшного» лица на дистанции.
 */
@ccclass('DrivePerfFix')
export class DrivePerfFix extends Component {

    private static _done = false;
    private static _anims: SkeletalAnimation[] = [];
    private static _warmTick = 0;
    private static _warmCarPos = new Vec3();
    private static _warmPosSaved = false;
    private static _frustumCover = false;
    private static _meshBatch: MeshRenderer[] = [];
    private static _skinBatch: SkinnedMeshRenderer[] = [];
    private static _tmpCamFwd = new Vec3();
    private static _tmpWarmPos = new Vec3();
    private static _tmpRight = new Vec3();

    /** True пока машина временно в кадре — нужен чёрный UI-оверлей. */
    public static isFrustumCoverActive(): boolean {
        return DrivePerfFix._frustumCover;
    }

    onLoad(): void {
        DrivePerfFix.apply();
    }

    public static apply(): void {
        if (DrivePerfFix._done) return;
        const scene = director.getScene();
        if (!scene) return;

        const car = DrivePerfFix._find(scene, 'banditcar');
        if (!car) {
            DrivePerfFix._done = true;
            return;
        }

        DrivePerfFix._anims = car.getComponentsInChildren(SkeletalAnimation);
        DrivePerfFix._meshBatch = car.getComponentsInChildren(MeshRenderer);
        DrivePerfFix._skinBatch = car.getComponentsInChildren(SkinnedMeshRenderer);

        for (const mr of [...DrivePerfFix._meshBatch, ...DrivePerfFix._skinBatch]) {
            if (!mr) continue;
            mr.shadowCastingMode = 0 as MeshRenderer['shadowCastingMode'];
            try { (mr as any).shadowReceivingMode = 0; } catch (_) { /* */ }
        }

        DrivePerfFix._disableSceneShadows(scene);
        BanditSwap.lockLod0AllCharacters();
        DrivePerfFix._done = true;
    }

    /**
     * Один тик прогрева (вызывать каждый кадр на Tap to Play).
     * @returns false когда закончено
     */
    public static warmUpTick(car: Node | null, cameraNode: Node | null = null): boolean {
        DrivePerfFix.apply();
        if (!car?.isValid) return false;

        const t = DrivePerfFix._warmTick++;
        DrivePerfFix._frustumCover = true;

        switch (t) {
            case 0:
                DrivePerfFix._touchMaterials(DrivePerfFix._meshBatch, 0, 20);
                return true;
            case 1:
                DrivePerfFix._touchMaterials(DrivePerfFix._meshBatch, 20, 50);
                return true;
            case 2:
                DrivePerfFix._touchMaterials(DrivePerfFix._meshBatch, 50, 999);
                return true;
            case 3:
                DrivePerfFix._touchMaterials(DrivePerfFix._skinBatch, 0, 999);
                return true;
            case 4:
                if (!DrivePerfFix._warmPosSaved) {
                    DrivePerfFix._warmCarPos.set(car.position);
                    DrivePerfFix._warmPosSaved = true;
                }
                DrivePerfFix._placeCarInFrontOfCamera(car, cameraNode, 5.5);
                return true;
            case 5:
                DrivePerfFix._placeCarInFrontOfCamera(car, cameraNode, 5.2);
                for (const a of DrivePerfFix._anims) {
                    if (!a?.isValid) continue;
                    try { a.pause(); a.resume(); } catch (_) { /* */ }
                }
                return true;
            case 6:
                DrivePerfFix._placeCarInFrontOfCamera(car, cameraNode, 4.2, 0.6);
                return true;
            case 7:
                DrivePerfFix._placeCarNearDriveEnd(car);
                return true;
            case 8:
                car.setPosition(DrivePerfFix._warmCarPos);
                DrivePerfFix._warmPosSaved = false;
                DrivePerfFix._frustumCover = false;
                BanditSwap.lockLod0AllCharacters();
                return false;
            default:
                DrivePerfFix._frustumCover = false;
                return false;
        }
    }

    public static finishWarmup(car: Node | null): void {
        if (car?.isValid && DrivePerfFix._warmPosSaved) {
            car.setPosition(DrivePerfFix._warmCarPos);
            DrivePerfFix._warmPosSaved = false;
        }
        DrivePerfFix._frustumCover = false;
        BanditSwap.lockLod0AllCharacters();
        DrivePerfFix._warmTick = 999;
    }

    public static beginDrive(): void {
        DrivePerfFix.apply();
        BanditSwap.lockLod0AllCharacters();

        for (const a of DrivePerfFix._anims) {
            if (!a?.isValid) continue;
            // Офицер играет Reaching Out во время заезда
            if (/ManPolice|Police/i.test(a.node?.name ?? '')) continue;
            try { a.pause(); } catch (_) {
                try { a.enabled = false; } catch (_) { /* */ }
            }
        }
    }

    public static endDrive(): void {
        BanditSwap.lockLod0AllCharacters();

        for (const a of DrivePerfFix._anims) {
            if (!a?.isValid) continue;
            try {
                a.enabled = true;
                a.resume();
            } catch (_) { /* */ }
        }
    }

    private static _placeCarInFrontOfCamera(
        car: Node,
        cameraNode: Node | null,
        dist: number,
        side: number = 0,
    ): void {
        let cam = cameraNode;
        if (!cam?.isValid) {
            const scene = director.getScene();
            if (scene) {
                const cams = scene.getComponentsInChildren(Camera);
                for (const c of cams) {
                    if (c?.node?.activeInHierarchy && c.enabled) {
                        cam = c.node;
                        break;
                    }
                }
            }
        }
        if (!cam?.isValid) {
            DrivePerfFix._placeCarNearDriveEnd(car);
            return;
        }

        Vec3.transformQuat(DrivePerfFix._tmpCamFwd, Vec3.FORWARD, cam.worldRotation);
        DrivePerfFix._tmpCamFwd.normalize();

        Vec3.cross(DrivePerfFix._tmpRight, DrivePerfFix._tmpCamFwd, Vec3.UP);
        if (DrivePerfFix._tmpRight.lengthSqr() < 1e-6) {
            DrivePerfFix._tmpRight.set(1, 0, 0);
        } else {
            DrivePerfFix._tmpRight.normalize();
        }

        const world = DrivePerfFix._tmpWarmPos;
        const camPos = cam.worldPosition;
        world.set(
            camPos.x + DrivePerfFix._tmpCamFwd.x * dist + DrivePerfFix._tmpRight.x * side,
            DrivePerfFix._warmCarPos.y,
            camPos.z + DrivePerfFix._tmpCamFwd.z * dist + DrivePerfFix._tmpRight.z * side,
        );
        car.setWorldPosition(world);
    }

    private static _placeCarNearDriveEnd(car: Node): void {
        const p = DrivePerfFix._tmpWarmPos;
        p.set(DrivePerfFix._warmCarPos);
        p.z -= 6.5;
        car.setPosition(p);
    }

    private static _touchMaterials(list: Renderer[], from: number, to: number): void {
        const end = Math.min(to, list.length);
        for (let i = from; i < end; i++) {
            const mr = list[i];
            if (!mr?.isValid || !mr.enabled) continue;
            const count = mr.materials?.length ?? 0;
            for (let m = 0; m < count; m++) {
                try {
                    const mat = mr.getMaterial(m);
                    if (!mat) continue;
                    mat.getProperty('mainTexture');
                    mat.getProperty('mainColor');
                } catch (_) { /* */ }
            }
        }
    }

    private static _disableSceneShadows(scene: Node): void {
        for (const light of scene.getComponentsInChildren(DirectionalLight)) {
            light.shadowEnabled = false;
        }
        try {
            const globals = (scene as any).globals;
            if (globals?.shadows) globals.shadows.enabled = false;
        } catch (_) { /* */ }
    }

    private static _find(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const c of root.children) {
            const f = DrivePerfFix._find(c, name);
            if (f) return f;
        }
        return null;
    }
}

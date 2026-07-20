import { _decorator, Component, Node, MeshRenderer, Texture2D, Vec4, director } from 'cc';

const { ccclass } = _decorator;

/**
 * Road — куб со scale (8, ·, 39). UV 0–1 без tiling → растяжение.
 * Чинит wrap=REPEAT и tiling под мировой scale.
 */
@ccclass('RoadTilingFix')
export class RoadTilingFix extends Component {

    private static _done = false;

    onLoad(): void {
        RoadTilingFix.fixInScene();
    }

    public static fixInScene(): void {
        if (RoadTilingFix._done) return;
        const scene = director.getScene();
        if (!scene) return;

        const road = RoadTilingFix._findByName(scene, 'Road');
        if (!road) return;

        const mr = road.getComponent(MeshRenderer);
        if (!mr) return;

        const scale = road.scale;
        const tileU = 1;
        const tileV = Math.max(1, Math.abs(scale.z / Math.max(0.001, scale.x)));

        const count = mr.materials?.length ?? 0;
        for (let i = 0; i < count; i++) {
            const mat = mr.getMaterial(i);
            if (!mat) continue;

            try {
                mat.setProperty('tilingOffset', new Vec4(tileU, tileV, 0, 0));
            } catch (_) { /* ignore */ }

            try {
                const tex = mat.getProperty('mainTexture') as Texture2D | null;
                if (tex?.isValid) {
                    tex.setWrapMode(Texture2D.WrapMode.REPEAT, Texture2D.WrapMode.REPEAT);
                }
            } catch (_) { /* ignore */ }
        }

        RoadTilingFix._done = true;
    }

    private static _findByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const c of root.children) {
            const f = RoadTilingFix._findByName(c, name);
            if (f) return f;
        }
        return null;
    }
}

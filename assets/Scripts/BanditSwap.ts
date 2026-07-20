import {
    Node, Tween, Vec3, SkinnedMeshRenderer, MeshRenderer, LODGroup, SkeletalAnimation, director,
} from 'cc';

const DRIVER_NAME = 'Bandit';
const ARRESTED_NAME = 'Bandit-arrested';

/**
 * Единая точка hide/show для swap водителя.
 */
export class BanditSwap {
    static hideDriver(driver: Node | null): void {
        if (!driver?.isValid) return;
        Tween.stopAllByTarget(driver);

        // Baked skinning: кратко включаем корень, чтобы достать все рендереры, потом гасим всё поддерево.
        if (!driver.active) driver.active = true;

        BanditSwap._walkSubtree(driver, (n) => {
            for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = false;
            for (const r of n.getComponents(MeshRenderer)) r.enabled = false;
            for (const r of n.getComponents(LODGroup)) r.enabled = false;
            for (const a of n.getComponents(SkeletalAnimation)) a.stop();
        });

        driver.setScale(0, 0, 0);
        BanditSwap._walkSubtree(driver, (n) => { n.active = false; });
        driver.active = false;
    }

    static showArrested(arrested: Node | null, pos?: Vec3): void {
        if (!arrested?.isValid) return;
        BanditSwap._setAncestorsActive(arrested);
        if (pos) arrested.setPosition(pos.x, pos.y, pos.z);
        arrested.setScale(1, 1, 1);
        arrested.active = true;

        BanditSwap._walkSubtree(arrested, (n) => {
            // Низкие LOD не включаем — иначе лицо «ломается» (Head_lod2)
            if (BanditSwap._isLowLodMesh(n.name)) {
                n.active = false;
                for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = false;
                for (const r of n.getComponents(MeshRenderer)) r.enabled = false;
                return;
            }
            n.active = true;
            for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = true;
            for (const r of n.getComponents(MeshRenderer)) r.enabled = true;
            // LODGroup сам переключает на lod2 вблизи камеры ареста — выкл.
            for (const g of n.getComponents(LODGroup)) g.enabled = false;
        });

        BanditSwap._forceHighLodOnly(arrested);
        // Повторно после show — на случай если LODGroup успел мигнуть
        BanditSwap.lockLod0(arrested);
    }

    /** Оставить только *_lod0 на персонаже; lod1/lod2 и LODGroup выкл. С любой дистанции. */
    public static lockLod0(root: Node | null): void {
        if (!root?.isValid) return;
        BanditSwap._forceHighLodOnly(root);
    }

    /** Bandit + Bandit-arrested + оба скина полиции — всегда hi-res. */
    public static lockLod0AllCharacters(): void {
        const names = [
            'Bandit',
            'Bandit-arrested',
            'ManPolice_skin1',
            'ManPolice_skin2',
            'ManPolice-skin1',
            'ManPolice-skin2',
        ];
        const scene = director.getScene() as unknown as Node | null;
        if (!scene?.isValid) return;
        for (const name of names) {
            BanditSwap._lockLod0ByName(scene, name);
        }
        // На всякий случай все LODGroup в сцене на персонажах уже гасятся в _forceHighLodOnly
    }

    private static _lockLod0ByName(root: Node, name: string): void {
        if (root.name === name) {
            BanditSwap._forceHighLodOnly(root);
        }
        for (const c of root.children) {
            BanditSwap._lockLod0ByName(c, name);
        }
    }

    /** Оставить только *_lod0 (тело + голова), lod1/lod2 выключить. */
    private static _forceHighLodOnly(root: Node): void {
        BanditSwap._walkSubtree(root, (n) => {
            const name = n.name || '';
            const lower = name.toLowerCase();
            if (lower.includes('shadowpars') || lower.includes('shadow_pars')) {
                n.active = false;
                for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = false;
                for (const r of n.getComponents(MeshRenderer)) r.enabled = false;
                return;
            }
            // LODGroup всегда выкл — на mobile он особенно агрессивно кидает на lod2
            for (const g of n.getComponents(LODGroup)) {
                g.enabled = false;
            }

            if (/_lod[12]$/i.test(name) || /_lod[12]\./i.test(name) || /_lod[12]_/i.test(name)) {
                n.active = false;
                for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = false;
                for (const r of n.getComponents(MeshRenderer)) r.enabled = false;
                return;
            }
            if (/_lod0$/i.test(name) || /_lod0\./i.test(name) || /_lod0_/i.test(name)) {
                // Не форсим active=true если предок выключен (скрытый arrested)
                n.active = true;
                for (const r of n.getComponents(SkinnedMeshRenderer)) r.enabled = true;
                for (const r of n.getComponents(MeshRenderer)) r.enabled = true;
            }
        });
    }

    private static _isLowLodMesh(name: string): boolean {
        const n = (name || '').toLowerCase();
        return n.includes('_lod1') || n.includes('_lod2');
    }

    static performSwap(
        car: Node | null,
        arrested: Node | null,
        pos: Vec3 | undefined,
        ...driverRefs: (Node | null)[]
    ): void {
        BanditSwap.hideAllDrivers(car, ...driverRefs);
        BanditSwap.hideEveryBanditInScene(arrested);
        BanditSwap.showArrested(arrested, pos);
    }

    /** Скрыть все ноды Bandit в сцене (кроме целевого arrested, если имя совпало). */
    static hideEveryBanditInScene(except: Node | null = null): void {
        const scene = director.getScene() as unknown as Node | null;
        if (!scene?.isValid) return;
        BanditSwap._hideBanditsUnder(scene, except);
    }

    /** Hide every in-car driver representation (inspector ref + sibling "Bandit" mesh). */
    static hideAllDrivers(car: Node | null, ...refs: (Node | null)[]): void {
        for (const n of BanditSwap.collectDriversToHide(car, ...refs)) {
            BanditSwap.hideDriver(n);
        }
    }

    static collectDriversToHide(car: Node | null, ...refs: (Node | null)[]): Node[] {
        const out: Node[] = [];
        const seen = new Set<string>();
        const add = (n: Node | null) => {
            if (!n?.isValid || seen.has(n.uuid)) return;
            seen.add(n.uuid);
            out.push(n);
        };
        for (const ref of refs) add(ref);
        if (car?.isValid) add(BanditSwap.findDirectChild(car, DRIVER_NAME));
        return out;
    }

    static resolveDriver(car: Node | null, ref: Node | null): Node | null {
        const all = BanditSwap.collectDriversToHide(car, ref);
        return all[0] ?? null;
    }

    static resolveArrested(chars: Node | null, ref: Node | null): Node | null {
        if (ref?.isValid && ref.name === ARRESTED_NAME) return ref;
        if (chars?.isValid) {
            const found = BanditSwap.findDirectChild(chars, ARRESTED_NAME);
            if (found) return found;
        }
        return BanditSwap.findInScene(ARRESTED_NAME);
    }

    static findDirectChild(parent: Node, name: string): Node | null {
        for (const child of parent.children) {
            if (child.name === name) return child;
        }
        return null;
    }

    static findInScene(name: string): Node | null {
        const scene = director.getScene() as unknown as Node | null;
        return scene?.isValid ? BanditSwap._findByName(scene, name) : null;
    }

    private static _findByName(root: Node, name: string): Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = BanditSwap._findByName(child, name);
            if (found) return found;
        }
        return null;
    }

    private static _setAncestorsActive(node: Node): void {
        let p = node.parent;
        while (p) {
            p.active = true;
            p = p.parent;
        }
    }

    private static _walkSubtree(root: Node, fn: (n: Node) => void): void {
        const stack: Node[] = [root];
        while (stack.length > 0) {
            const n = stack.pop()!;
            fn(n);
            for (const child of n.children) stack.push(child);
        }
    }

    private static _hideBanditsUnder(root: Node, except: Node | null): void {
        if (root.name === DRIVER_NAME && root !== except) {
            BanditSwap.hideDriver(root);
        }
        for (const child of root.children) {
            BanditSwap._hideBanditsUnder(child, except);
        }
    }
}

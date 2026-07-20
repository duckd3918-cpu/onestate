import {
    _decorator, Component, Node, SpotLight, director,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Фары машины: включает SpotLight headlight* и меши Headlight*_lod0.
 * (Раньше подменял на FakeGlow ради FPS — сейчас по запросу оставляем реальные фары.)
 */
@ccclass('FakeLightGlow')
export class FakeLightGlow extends Component {

    @property({ tooltip: 'false = реальные фары; true = старый FakeGlow без SpotLight' })
    useFakeGlow: boolean = false;

    private static _done = false;

    onLoad(): void {
        FakeLightGlow.enableHeadlights();
    }

    /** Включить фары (SpotLight + меши). */
    public static enableHeadlights(): void {
        if (FakeLightGlow._done) return;
        const scene = director.getScene();
        if (!scene) return;

        const spots = scene.getComponentsInChildren(SpotLight);
        for (const light of spots) {
            if (!light?.node?.isValid) continue;
            const n = (light.node.name || '').toLowerCase();
            if (n !== 'headlight' && n !== 'headlight-001' && !n.startsWith('headlight')) continue;
            light.enabled = true;
            light.node.active = true;
        }

        // Визуальные колбы/конусы фар на кузове
        FakeLightGlow._activateNamed(scene, [
            'HeadlightL_lod0', 'HeadlightR_lod0',
            'HeadlightL', 'HeadlightR',
        ]);

        FakeLightGlow._done = true;
    }

    /** @deprecated совместимость с GameFlow */
    public static replaceHeadlightsOnly(): void {
        FakeLightGlow.enableHeadlights();
    }

    private static _activateNamed(root: Node, names: string[]): void {
        const want = new Set(names.map(n => n.toLowerCase()));
        const walk = (n: Node) => {
            if (want.has((n.name || '').toLowerCase())) {
                n.active = true;
            }
            for (const c of n.children) walk(c);
        };
        walk(root);
    }
}

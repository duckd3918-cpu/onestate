import {
    _decorator, Component, director, view, Camera, Bloom, SpotLight, Color,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * Perf в portrait:
 *  - 3 красных SpotLight: landscape всегда;
 *    portrait — с DocumentCard и на WANTED/Arrest до конца игры
 *  - пустой PostProcess (Bloom off) выключаем
 */
@ccclass('PortraitPerf')
export class PortraitPerf extends Component {

    @property({ tooltip: 'Выключить PostProcess, если Bloom disabled' })
    disableEmptyPostProcess: boolean = true;

    /** DocumentCard на экране. */
    private static _docCardVisible = false;
    /** WANTED / арест — споты нужны в portrait до конца. */
    private static _wantedOrArrest = false;
    private static _redSpots: SpotLight[] = [];
    private static _resolved = false;

    onLoad(): void {
        PortraitPerf.apply(this.disableEmptyPostProcess);
        view.on('canvas-resize', this._onResize, this);
    }

    onDestroy(): void {
        view.off('canvas-resize', this._onResize, this);
    }

    private _onResize = (): void => {
        PortraitPerf.apply(this.disableEmptyPostProcess);
    };

    /** Вызвать при появлении / скрытии DocumentCard. */
    public static setDocumentCardVisible(visible: boolean): void {
        PortraitPerf._docCardVisible = visible;
        PortraitPerf._applyRedSpots();
    }

    /** WANTED → арест → end: красные споты в portrait остаются. */
    public static setWantedOrArrestActive(active: boolean): void {
        PortraitPerf._wantedOrArrest = active;
        PortraitPerf._applyRedSpots();
    }

    public static apply(disableEmptyPostProcess: boolean = true): void {
        const scene = director.getScene();
        if (!scene) return;

        if (disableEmptyPostProcess) {
            for (const cam of scene.getComponentsInChildren(Camera)) {
                if (!cam?.isValid || !cam.usePostProcess) continue;
                const bloom = cam.node.getComponent(Bloom);
                if (!(bloom && bloom.enabled)) {
                    cam.usePostProcess = false;
                }
            }
        }

        PortraitPerf._applyRedSpots();
    }

    private static _applyRedSpots(): void {
        PortraitPerf._resolveRedSpots();
        const portrait = view.getVisibleSize().height >= view.getVisibleSize().width;
        // Landscape: всегда. Portrait: DocumentCard или WANTED/Arrest.
        const on = !portrait
            || PortraitPerf._docCardVisible
            || PortraitPerf._wantedOrArrest;
        for (const light of PortraitPerf._redSpots) {
            if (!light?.isValid) continue;
            light.enabled = on;
        }
    }

    /** Три красных Spot Light / Spot Light-001 на полицейской машине (не фары). */
    private static _resolveRedSpots(): void {
        if (PortraitPerf._resolved) {
            PortraitPerf._redSpots = PortraitPerf._redSpots.filter(l => l?.isValid);
            if (PortraitPerf._redSpots.length >= 3) return;
        }

        const scene = director.getScene();
        if (!scene) return;

        const found: SpotLight[] = [];
        for (const light of scene.getComponentsInChildren(SpotLight)) {
            if (!light?.node?.isValid) continue;
            const n = (light.node.name || '').toLowerCase();
            if (n.startsWith('headlight')) continue;

            const c = light.color as Color;
            const isRed = c && c.r >= 200 && c.g <= 40 && c.b <= 40;
            if (!isRed) continue;

            // Короткие красные споты на кузове (range ~0.8)
            if (light.range > 3) continue;
            found.push(light);
        }

        PortraitPerf._redSpots = found.slice(0, 3);
        PortraitPerf._resolved = true;
    }
}

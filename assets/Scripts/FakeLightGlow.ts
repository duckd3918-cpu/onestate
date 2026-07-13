import {
    _decorator, Component, Node, MeshRenderer, utils, primitives,
    Material, Color, tween, PointLight, SpotLight, director,
    Texture2D, gfx, Layers,
} from 'cc';
import { FaceCameraBillboard } from './FaceCameraBillboard';

const { ccclass, property } = _decorator;

type AnyLight = PointLight | SpotLight;

/**
 * Дешёвая замена PointLight / SpotLight: unlit-ореол лицом к камере.
 */
@ccclass('FakeLightGlow')
export class FakeLightGlow extends Component {

    @property
    scaleMul: number = 3.5;

    @property
    pulseFlashers: boolean = true;

    private static _glowTex: Texture2D | null = null;
    private static _done = false;

    onLoad(): void {
        FakeLightGlow.replacePointLightsInScene(this.scaleMul, this.pulseFlashers);
    }

    public static replacePointLightsInScene(scaleMul: number = 3.5, pulseFlashers: boolean = true): void {
        if (FakeLightGlow._done) return;
        const scene = director.getScene();
        if (!scene) {
            console.warn('[FakeLightGlow] no scene');
            return;
        }

        let count = 0;
        const lights: AnyLight[] = [
            ...scene.getComponentsInChildren(PointLight),
            ...scene.getComponentsInChildren(SpotLight),
        ];

        for (const light of lights) {
            if (!light?.node?.isValid) continue;
            try {
                FakeLightGlow._replaceOne(light, scaleMul, pulseFlashers);
                count++;
            } catch (e) {
                console.error('[FakeLightGlow] failed on', light.node?.name, e);
            }
        }
        FakeLightGlow._done = true;
        console.log(`[FakeLightGlow] replaced ${count} light(s) (Point+Spot)`);
    }

    public static reset(): void {
        FakeLightGlow._done = false;
    }

    private static _replaceOne(light: AnyLight, scaleMul: number, pulseFlashers: boolean): void {
        const node = light.node;
        const name = (node.name || '').toLowerCase();
        light.enabled = false;

        if (node.getChildByName('FakeGlow')) return;

        let color = new Color(255, 230, 150, 255);
        let scale = 3.0;
        let pulse = false;
        let period = 0.5;
        let phase = 0;

        if (name.includes('blue')) {
            color = new Color(80, 160, 255, 255);
            scale = 4.5;
            pulse = pulseFlashers;
            phase = 0;
        } else if (name.includes('red') && name.includes('flash')) {
            color = new Color(255, 60, 50, 255);
            scale = 4.5;
            pulse = pulseFlashers;
            phase = 0.5;
        } else if (name.includes('headlight')) {
            // Фары — мягкий белый, чуть впереди ноды SpotLight
            color = new Color(255, 245, 220, 110);
            scale = 1.35;
        } else if (name.includes('spot')) {
            // 3 Spot Light = задние фонари (красные)
            color = new Color(255, 40, 35, 160);
            scale = 2.0;
        } else if (name === 'light' || name.includes('lamp') || name.includes('street')) {
            color = new Color(255, 235, 170, 255);
            scale = 4.0;
        } else {
            const c = light.color;
            if (c) color = new Color(c.r, c.g, c.b, 255);
            // range у headlight = 10 — не масштабируем напрямую
            const r = Math.min(light.range || 1, 2);
            scale = Math.max(1.5, r * scaleMul);
        }

        const glow = new Node('FakeGlow');
        glow.layer = Layers.Enum.DEFAULT;
        node.addChild(glow);
        // Фары: SpotLight сидит глубже в кузове — выносим ореол вперёд по локальному Z
        if (name.includes('headlight')) {
            glow.setPosition(0, 0.05, 0.55);
        } else {
            glow.setPosition(0, 0, 0);
        }
        glow.setScale(scale, scale, scale);

        const mr = glow.addComponent(MeshRenderer);
        mr.mesh = utils.createMesh(primitives.quad());
        const mat = FakeLightGlow._makeGlowMaterial(color);
        mr.setMaterial(mat, 0);
        (mr as any).shadowCastingMode = 0;

        glow.addComponent(FaceCameraBillboard);

        if (pulse) {
            const lo = 0.2;
            const hi = 1.0;
            const proxy = { t: hi };
            tween(proxy)
                .delay(period * phase)
                .repeatForever(
                    tween(proxy)
                        .to(period, { t: lo }, {
                            onUpdate: () => {
                                if (!mat.isValid || !glow.isValid) return;
                                const a = Math.floor(255 * proxy.t);
                                mat.setProperty('mainColor', new Color(color.r, color.g, color.b, a));
                                const s = scale * (0.85 + 0.25 * proxy.t);
                                glow.setScale(s, s, s);
                            },
                        })
                        .to(period, { t: hi }, {
                            onUpdate: () => {
                                if (!mat.isValid || !glow.isValid) return;
                                const a = Math.floor(255 * proxy.t);
                                mat.setProperty('mainColor', new Color(color.r, color.g, color.b, a));
                                const s = scale * (0.85 + 0.25 * proxy.t);
                                glow.setScale(s, s, s);
                            },
                        }),
                )
                .start();
        }
    }

    private static _makeGlowMaterial(color: Color): Material {
        const mat = new Material();
        mat.initialize({
            effectName: 'builtin-unlit',
            technique: 1,
            defines: { USE_TEXTURE: true },
        });
        mat.setProperty('mainTexture', FakeLightGlow._getGlowTexture());
        mat.setProperty('mainColor', color);
        mat.overridePipelineStates({
            blendState: {
                targets: [{
                    blend: true,
                    blendSrc: gfx.BlendFactor.SRC_ALPHA,
                    blendDst: gfx.BlendFactor.ONE,
                    blendEq: gfx.BlendOp.ADD,
                    blendSrcAlpha: gfx.BlendFactor.SRC_ALPHA,
                    blendDstAlpha: gfx.BlendFactor.ONE,
                    blendAlphaEq: gfx.BlendOp.ADD,
                }],
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: false,
            },
            rasterizerState: {
                cullMode: gfx.CullMode.NONE,
            },
        });
        return mat;
    }

    private static _getGlowTexture(): Texture2D {
        if (FakeLightGlow._glowTex?.isValid) return FakeLightGlow._glowTex;

        const size = 64;
        const data = new Uint8Array(size * size * 4);
        const cx = (size - 1) * 0.5;
        const cy = (size - 1) * 0.5;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const d = Math.hypot(x - cx, y - cy) / (size * 0.5);
                const a = d >= 1 ? 0 : Math.pow(1 - d, 1.6);
                const i = (y * size + x) * 4;
                const v = Math.min(255, Math.floor(255 * (1 - d * 0.35)));
                data[i] = v;
                data[i + 1] = v;
                data[i + 2] = v;
                data[i + 3] = Math.min(255, Math.floor(a * 255));
            }
        }

        const tex = new Texture2D();
        tex.reset({
            width: size,
            height: size,
            format: Texture2D.PixelFormat.RGBA8888,
        });
        tex.uploadData(data);
        tex.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE, Texture2D.WrapMode.CLAMP_TO_EDGE);
        tex.setFilters(Texture2D.Filter.LINEAR, Texture2D.Filter.LINEAR);
        FakeLightGlow._glowTex = tex;
        return tex;
    }
}

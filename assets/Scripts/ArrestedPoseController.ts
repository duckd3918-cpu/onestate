import {
    _decorator, Component, Node, Vec3,
} from 'cc';
import { BanditSwap } from './BanditSwap';

const { ccclass, property } = _decorator;

const POLICE_IDLE_NAMES = ['ManPolice_skin1', 'ManPolice-skin1', 'manpolice-skin1'];
const POLICE_ARREST_NAMES = ['ManPolice_skin2', 'ManPolice-skin2', 'manpolice-skin2'];

/**
 * Только ссылки на ноды из Inspector. Swap выполняет GameFlowController.
 */
@ccclass('ArrestedPoseController')
export class ArrestedPoseController extends Component {
    @property({ type: Node, tooltip: 'Vehicles/banditcar/Bandit' })
    originalDriver: Node | null = null;

    @property({ type: Node, tooltip: 'Characters/Bandit-arrested' })
    arrestedDriver: Node | null = null;

    @property({ type: Node, tooltip: 'Characters' })
    charactersRoot: Node | null = null;

    @property({ type: Node, tooltip: 'Characters/ManPolice_skin1 (idle / punch)' })
    officerSkin1: Node | null = null;

    @property({ type: Node, tooltip: 'Characters/ManPolice_skin2 (поза ареста, руки у запястий)' })
    officerSkin2: Node | null = null;

    @property({ tooltip: 'Телепорт в criminalSpawnPos. Выкл. = позиция из редактора.' })
    useSpawnPosition: boolean = false;

    @property({ tooltip: 'Локальная позиция Bandit-arrested (если useSpawnPosition)' })
    criminalSpawnPos: Vec3 = new Vec3(0.95, 0.01, 6.15);

    onLoad(): void {
        const arrested = BanditSwap.resolveArrested(this.charactersRoot, this.arrestedDriver);
        if (arrested) BanditSwap.hideDriver(arrested);

        // skin2 — только в кадре ареста при отдалении камеры
        const skin2 = this.resolveOfficerSkin2();
        if (skin2) BanditSwap.hideDriver(skin2);
    }

    resolveOfficerSkin1(): Node | null {
        return this._resolveOfficer(this.officerSkin1, POLICE_IDLE_NAMES);
    }

    resolveOfficerSkin2(): Node | null {
        return this._resolveOfficer(this.officerSkin2, POLICE_ARREST_NAMES);
    }

    /** Под затемнением: выкл. skin1, вкл. skin2 (поза наручников). */
    swapOfficerToArrestPose(): boolean {
        const skin1 = this.resolveOfficerSkin1();
        const skin2 = this.resolveOfficerSkin2();
        if (!skin2) {
            console.warn('[ArrestedPose] ManPolice_skin2 not found — skip officer swap');
            return false;
        }
        if (skin1) BanditSwap.hideDriver(skin1);
        BanditSwap.showArrested(skin2);
        BanditSwap.lockLod0(skin2);
        return true;
    }

    private _resolveOfficer(ref: Node | null, names: string[]): Node | null {
        if (ref?.isValid) return ref;
        const root = this.charactersRoot;
        if (root?.isValid) {
            for (const name of names) {
                const found = BanditSwap.findDirectChild(root, name);
                if (found) return found;
            }
        }
        for (const name of names) {
            const found = BanditSwap.findInScene(name);
            if (found) return found;
        }
        return null;
    }
}

export { BanditSwap } from './BanditSwap';

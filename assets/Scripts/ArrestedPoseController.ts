import {
    _decorator, Component, Node, Vec3,
} from 'cc';
import { BanditSwap } from './BanditSwap';

const { ccclass, property } = _decorator;

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

    @property({ tooltip: 'Телепорт в criminalSpawnPos. Выкл. = позиция из редактора.' })
    useSpawnPosition: boolean = false;

    @property({ tooltip: 'Локальная позиция Bandit-arrested (если useSpawnPosition)' })
    criminalSpawnPos: Vec3 = new Vec3(0.95, 0.01, 6.15);

    onLoad(): void {
        const arrested = BanditSwap.resolveArrested(this.charactersRoot, this.arrestedDriver);
        if (arrested) BanditSwap.hideDriver(arrested);
    }
}

export { BanditSwap } from './BanditSwap';

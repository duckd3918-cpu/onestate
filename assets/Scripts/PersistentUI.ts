import {
    _decorator, Component, Node, UIOpacity, tween, Vec3, Tween,
    screen, view, Size, Widget, UITransform, sys,
} from 'cc';

const { ccclass, property } = _decorator;

/**
 * PersistentUI — Logo + Play Now.
 * В landscape: scale × mul, математический стек (лого → gap → кнопка),
 * плюс больший top у родительского Widget.
 * Top учитывает safe-area (Dynamic Island / notch), без двойного запаса —
 * иначе на iPhone лого/Play Now уезжают вниз и их режет DocumentCard.
 */
@ccclass('PersistentUI')
export class PersistentUI extends Component {
    @property(Node)
    logo: Node | null = null;

    @property(Node)
    playNowButton: Node | null = null;

    @property({ tooltip: 'Во сколько раз увеличить Logo и Play Now в landscape' })
    landscapeScaleMul: number = 1.75;

    @property({ tooltip: 'Минимальный зазор между низом лого и верхом кнопки (portrait)' })
    gapPortrait: number = 18;

    @property({ tooltip: 'Минимальный зазор между низом лого и верхом кнопки (landscape)' })
    gapLandscape: number = 36;

    @property({ tooltip: 'Top родителя в landscape (доля высоты экрана, 0–1). Больше = ниже от края' })
    landscapeParentTop: number = 0.07;

    @property({ tooltip: 'Доп. отступ под notch (доля высоты). 0 = только реальный safe-area / base top' })
    safeAreaExtraTop: number = 0;

    public onPlayNow: (() => void) | null = null;

    private _hidden = false;

    private _logoBasePos = new Vec3();
    private _logoBaseScale = new Vec3(1, 1, 1);
    private _btnBasePos = new Vec3();
    private _btnBaseScale = new Vec3(1, 1, 1);

    private _parentWidget: Widget | null = null;
    private _parentBaseTop = 0;
    private _parentTopIsAbs = false;

    onLoad(): void {
        this._setOpacity(this.logo, 255);
        this._setOpacity(this.playNowButton, 255);

        if (this.logo) {
            this._logoBasePos = this.logo.position.clone();
            this._logoBaseScale = this.logo.scale.clone();
            this.logo.on(Node.EventType.TOUCH_START, this._onTap, this);
        }
        if (this.playNowButton) {
            this._btnBasePos = this.playNowButton.position.clone();
            this._btnBaseScale = this.playNowButton.scale.clone();
            this.playNowButton.on(Node.EventType.TOUCH_START, this._onTap, this);
        }

        this._parentWidget = this.getComponent(Widget);
        if (this._parentWidget) {
            this._parentBaseTop = this._parentWidget.top;
            this._parentTopIsAbs = this._parentWidget.isAbsTop;
        }

        this._applyLayout();
        this._pulsateButton();
        // После первого кадра Canvas/Widget уже посчитали размер
        this.scheduleOnce(this._relayout, 0);

        try {
            screen.on('window-resize', this._onResize, this);
            view.on('canvas-resize', this._onResize, this);
        } catch (_) { /* ignore */ }
    }

    onDestroy(): void {
        try {
            screen.off('window-resize', this._onResize, this);
            view.off('canvas-resize', this._onResize, this);
        } catch (_) { /* ignore */ }
    }

    private _onResize = (): void => {
        this.unschedule(this._relayout);
        this.scheduleOnce(this._relayout, 0);
    };

    private _relayout = (): void => {
        this._applyLayout();
        this._pulsateButton();
    };

    private _onTap(): void {
        if (this.onPlayNow) this.onPlayNow();
    }

    public hide(): void {
        if (this._hidden) return;
        this._hidden = true;
        this._fadeTo(this.logo, 0, 0.4);
        this._fadeTo(this.playNowButton, 0, 0.4);
    }

    public show(): void {
        this._hidden = false;
        this._fadeTo(this.logo, 255, 0.3);
        this._fadeTo(this.playNowButton, 255, 0.3);
    }

    private _isPortrait(): boolean {
        const size: Size = view.getVisibleSize();
        return size.height >= size.width;
    }

    /**
     * Верхний inset (доля высоты): только реальный safe-area из API.
     * Playable webview на iPhone часто уже лежит ниже notch — фейковый
     * fallback 7% давал пустоту над лого и обрезал Play Now карточкой.
     */
    private _safeTopFraction(): number {
        const vs = view.getVisibleSize();
        if (vs.height <= 0) return 0;

        let topPx = 0;
        try {
            const sa = sys.getSafeAreaRect();
            topPx = Math.max(0, vs.height - sa.y - sa.height);
        } catch { /* ignore */ }

        // Игнор шума < 2px; cap ~3% — хватает на status bar, без «провала» под Dynamic Island
        if (topPx < 2) return 0;
        return Math.min(topPx / vs.height, 0.03);
    }

    /**
     * Portrait: базовые pos/scale из редактора (с минимальным gap).
     * Landscape: scale × mul, кнопка Y = низ_лого − gap − половина_высоты_кнопки.
     * Top: max(base, safe) — не складываем отступы (иначе двойной pad на iPhone).
     */
    private _applyLayout(): void {
        if (!this.logo?.isValid || !this.playNowButton?.isValid) return;

        const portrait = this._isPortrait();
        const mul = portrait ? 1 : this.landscapeScaleMul;
        const minGap = portrait ? this.gapPortrait : this.gapLandscape;
        const safeTop = this._safeTopFraction() + this.safeAreaExtraTop;

        // ── Parent top (отступ сверху экрана) ─────────────────────────────
        if (this._parentWidget?.isValid) {
            if (portrait) {
                if (this._parentTopIsAbs) {
                    const vs = view.getVisibleSize();
                    this._parentWidget.isAbsTop = true;
                    // max: editor pad ИЛИ safe-area, не сумма
                    this._parentWidget.top = Math.max(this._parentBaseTop, safeTop * vs.height);
                } else {
                    this._parentWidget.isAbsTop = false;
                    this._parentWidget.top = Math.max(this._parentBaseTop, safeTop);
                }
            } else {
                this._parentWidget.isAbsTop = false;
                const baseLand = Math.max(
                    this._parentTopIsAbs ? 0.04 : this._parentBaseTop,
                    this.landscapeParentTop,
                );
                this._parentWidget.top = Math.max(baseLand, safeTop);
            }
            this._parentWidget.updateAlignment();
        }

        // ── Scales ────────────────────────────────────────────────────────
        const logoScale = new Vec3(
            this._logoBaseScale.x * mul,
            this._logoBaseScale.y * mul,
            this._logoBaseScale.z,
        );
        const btnScale = new Vec3(
            this._btnBaseScale.x * mul,
            this._btnBaseScale.y * mul,
            this._btnBaseScale.z,
        );
        this.logo.setScale(logoScale);

        const logoUt = this.logo.getComponent(UITransform);
        const btnUt = this.playNowButton.getComponent(UITransform);
        const logoH = (logoUt?.height ?? 550) * logoScale.y;
        const btnH = (btnUt?.height ?? 93) * btnScale.y;

        // Исходный gap при base scale
        const logoH0 = (logoUt?.height ?? 550) * this._logoBaseScale.y;
        const btnH0 = (btnUt?.height ?? 93) * this._btnBaseScale.y;
        const logoBottom0 = this._logoBasePos.y - logoH0 * 0.5;
        const btnTop0 = this._btnBasePos.y + btnH0 * 0.5;
        const gap0 = logoBottom0 - btnTop0;
        const gap = Math.max(gap0 > 0 ? gap0 * mul : minGap, minGap);

        // Лого: X как в редакторе; Y чуть ниже в landscape если нужно —
        // основной top даёт parent Widget. Центр лого оставляем.
        const logoX = this._logoBasePos.x;
        const logoY = this._logoBasePos.y;
        this.logo.setPosition(logoX, logoY, this._logoBasePos.z);

        // Кнопка строго под лого:
        //   logoBottom = logoY - logoH/2
        //   btnTop     = logoBottom - gap
        //   btnY       = btnTop - btnH/2
        const logoBottom = logoY - logoH * 0.5;
        const btnY = logoBottom - gap - btnH * 0.5;
        const btnX = this._btnBasePos.x;

        this.playNowButton.setPosition(btnX, btnY, this._btnBasePos.z);
        // scale кнопки ставит _pulsateButton (base = btnScale)
        this.playNowButton.setScale(btnScale);
    }

    private _pulsateButton(): void {
        if (!this.playNowButton?.isValid) return;
        const btn = this.playNowButton;
        const mul = this._isPortrait() ? 1 : this.landscapeScaleMul;
        const base = new Vec3(
            this._btnBaseScale.x * mul,
            this._btnBaseScale.y * mul,
            this._btnBaseScale.z,
        );
        const big = new Vec3(base.x * 1.06, base.y * 1.06, base.z);

        // Не сбрасываем Y — только scale
        Tween.stopAllByTarget(btn);
        btn.setScale(base);
        tween(btn)
            .repeatForever(
                tween(btn)
                    .to(0.8, { scale: big }, { easing: 'sineOut' })
                    .to(0.8, { scale: base.clone() }, { easing: 'sineIn' }),
            )
            .start();
    }

    private _setOpacity(node: Node | null, a: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    private _fadeTo(node: Node | null, to: number, time: number): void {
        if (!node) return;
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        tween(op).to(time, { opacity: to }).start();
    }
}

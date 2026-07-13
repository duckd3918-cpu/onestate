import {
    _decorator, Component, Node, tween, Tween, Vec3,
    UIOpacity, Sprite, SpriteFrame, EventTouch,
    Label, UITransform, AudioSource, AudioClip,
} from 'cc';

const { ccclass, property } = _decorator;

/** Состояние одной кнопки поля */
enum FieldState { Idle, Checking, Done, Error }

interface DocField {
    node: Node;
    checkBtn: Node | null;
    state: FieldState;
}

/**
 * DocumentCheckUI  — Phase 2
 *
 * Иерархия DocumentCard (пример для 5 полей):
 *   DocumentCard
 *     ├── Плашка          (Sprite: плашкафинал.webp) ← cardPlaque
 *     ├── Field_Name
 *     │     └── CheckBtn  (Sprite: checkbutton.webp)
 *     ├── Field_DOB  └── CheckBtn
 *     ├── Field_Issue └── CheckBtn
 *     ├── Field_Reg  └── CheckBtn
 *     ├── Field_Expire  ← ПОСЛЕДНЕЕ = ERROR
 *     │     └── CheckBtn
 *     ├── FingerHint
 *     ├── ScanBarFill  (Sprite: progressbarillusion.webp)
 *     └── WantedStamp  (Sprite: wanted.webp, scale=0)
 *
 * Логика кнопок:
 *   checkbutton → tap → pop-out → inProgress (loop ↔ inProgress2) → pop-out → check|error
 *
 * Progress bar illusion:
 *   ScanBarFill anchor = (0, 0.5). scale.x: 0 → (N/total) после каждого check.
 *
 * Последнее поле = ERROR → WANTED stamp + сирена + красные вспышки.
 */
@ccclass('DocumentCheckUI')
export class DocumentCheckUI extends Component {

    // ── Поля ──────────────────────────────────────────────────────────────
    @property({ type: [Node], tooltip: 'Ноды полей. Последнее даёт ERROR.' })
    fields: Node[] = [];

    // ── Подсказка ─────────────────────────────────────────────────────────
    @property({ type: Node, tooltip: 'FingerHint — нода пальца-подсказки' })
    fingerHint: Node | null = null;

    @property({ tooltip: 'Секунд бездействия до усиления подсказки (первый показ — сразу)' })
    hintIdleTime: number = 4;

    @property({ tooltip: 'Смещение руки относительно центра check-кнопки (X)' })
    hintOffsetX: number = 0;

    @property({ tooltip: 'Смещение руки относительно центра check-кнопки (Y). Отрицательное = ниже кнопки' })
    hintOffsetY: number = -40;

    // ── Progress bar ──────────────────────────────────────────────────────
    @property({ type: Node, tooltip: 'ScanBarFill — нода заполнения прогресс-бара (anchor должен быть (0, 0.5))' })
    scanBarFill: Node | null = null;

    // ── Плашка документа (для тряски) ─────────────────────────────────────
    @property({ type: Node, tooltip: 'Плашка документа (для тряски при WANTED)' })
    cardPlaque: Node | null = null;

    // ── Виньетка тревоги ──────────────────────────────────────────────────
    // Используем redFlash как виньетку — оставляем поле для обратной совместимости
    @property({ type: Node, tooltip: 'RedVignette — нода красной виньетки (loop при WANTED). Если не задана, используется RedFlash.' })
    redVignette: Node | null = null;

    // ── Спрайты ───────────────────────────────────────────────────────────
    @property({ type: SpriteFrame, tooltip: 'checkbutton.webp' })
    sfCheckBtn: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: 'in progress.webp' })
    sfInProgress: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: 'in progress2.webp' })
    sfInProgress2: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: 'check.webp' })
    sfCheck: SpriteFrame | null = null;
    @property({ type: SpriteFrame, tooltip: 'error.webp' })
    sfError: SpriteFrame | null = null;

    // ── WANTED штамп ──────────────────────────────────────────────────────
    @property({ type: Node, tooltip: 'WantedStamp (изначально scale=0)' })
    wantedStamp: Node | null = null;

    // ── RedFlash / RedVignette ────────────────────────────────────────────
    // Используется и для вспышек (4 раза быстро), и для постоянной пульсирующей виньетки
    @property({ type: Node, tooltip: 'RedFlash — нода красного оверлея (вспышки + виньетка при WANTED)' })
    redFlash: Node | null = null;

    // ── Субтитры ──────────────────────────────────────────────────────────
    @property({ type: Label, tooltip: 'Label субтитров' })
    subtitle: Label | null = null;

    // ── Аудио ─────────────────────────────────────────────────────────────
    @property({ type: AudioClip, tooltip: 'siren.wav' })
    audioSiren: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'arrest.mp3' })
    audioArrest: AudioClip | null = null;

    @property({ type: AudioClip, tooltip: 'checking documents.mp3' })
    audioChecking: AudioClip | null = null;

    // ── Тайминги ──────────────────────────────────────────────────────────
    @property({ tooltip: 'Секунд анимации inProgress перед результатом (обычные поля; last = это + errorExtra)' })
    checkingDuration: number = 1.5;

    @property({ tooltip: 'Доп. задержка для ERROR (последнее поле)' })
    errorExtraDelay: number = 0.3;

    @property({ tooltip: 'Множитель длительности обычных полей (0.67 ≈ +50% скорость). Последнее поле не трогаем.' })
    normalCheckSpeedMul: number = 2 / 3;

    @property({ tooltip: 'Интервал смены inProgress ↔ inProgress2 (сек). 0.175 = в 2 раза быстрее старых 0.35' })
    inProgressSwapInterval: number = 0.175;

    // ── Callbacks ─────────────────────────────────────────────────────────
    /** Вызывается после падения WANTED (переход в Arrest). */
    public onWanted: (() => void) | null = null;

    // ── Приватное состояние ───────────────────────────────────────────────
    private _fields: DocField[] = [];
    private _currentIndex: number = 0;
    private _idleTimer: number = 0;
    private _hintShownOnce: boolean = false;   // подсказка показывалась хотя бы раз
    private _barAnchorReady: boolean = false;   // anchor BarFill уже настроен
    private _hintActive: boolean = false;
    private _progressStep: number = 0;
    private _totalFields: number = 0;
    private _done: boolean = false;
    private _audioSrc: AudioSource | null = null;
    private _arrestAudioSrc: AudioSource | null = null;
    private _vignetteRunning: boolean = false;

    // Для inProgress loop
    private _loopBtn: Node | null = null;
    private _loopToggle: boolean = false;
    private _loopRunning: boolean = false;

    // ─────────────────────────────────────────────────────────────────────
    onLoad(): void {
        this._audioSrc = this.node.getComponent(AudioSource);
        if (!this._audioSrc) this._audioSrc = this.node.addComponent(AudioSource);

        for (const f of this.fields) {
            const btn = f.getChildByName('CheckBtn') ?? f.getChildByName('check');
            this._fields.push({ node: f, checkBtn: btn, state: FieldState.Idle });
            if (btn) {
                btn.setScale(1, 1, 1);
                this._setOp(btn, 255);
                // НЕ квадратим здесь — checkbutton.webp может быть прямоугольным.
                // Квадратизацию применяем только после смены на check.webp / error.webp.
            }
        }
        this._totalFields = this._fields.length;

        // Авто-резолв: если scanBarFill указывает на ScanBar (родитель),
        // ищем дочернюю ноду внутри неё.
        if (this.scanBarFill) {
            const child = this.scanBarFill.getChildByName('BarFill')
                ?? this.scanBarFill.getChildByName('Fill')
                ?? this.scanBarFill.getChildByName('bar_fill');
            // Если по имени не нашли — берём первого ребёнка (это FAKEPROGRESSBAR)
            if (child) {
                this.scanBarFill = child;
            } else if (this.scanBarFill.children.length > 0) {
                this.scanBarFill = this.scanBarFill.children[0];
            }
        }

        // BarFill настраивается позже в begin() — после того как Widget отработает.
        // Пока просто убеждаемся что scale=1 (полностью закрыт — фон не виден)
        if (this.scanBarFill) {
            this.scanBarFill.setScale(1, 1, 1);
        }

        if (this.wantedStamp) this.wantedStamp.setScale(0, 0, 0);
        if (this.redVignette) this._setOp(this.redVignette, 0);
        if (this.redFlash) this._setOp(this.redFlash, 0);
        if (this.fingerHint) this.fingerHint.active = false;  // скрыта до begin()
    }

    /**
     * Запустить фазу проверки документов.
     * Вызывается из GameFlowController, нода уже active.
     */
    public begin(): void {
        this._currentIndex = 0;
        this._done = false;
        this._progressStep = 0;
        this._idleTimer = 0;
        this._hintShownOnce = false;
        this._hintActive = false;
        this._loopRunning = false;
        this._loopBtn = null;
        this._vignetteRunning = false;

        this._fields.forEach(f => { f.state = FieldState.Idle; });

        // Показываем субтитр начала фазы
        this._showSubtitle("Let's see here.", 3.0);

        // Настраиваем anchor BarFill один раз — Widget уже отработал к моменту begin()
        if (!this._barAnchorReady) {
            this._setupBarAnchor();
        }

        // Tap listeners
        for (const f of this._fields) {
            f.node.off(Node.EventType.TOUCH_START, this._onFieldTap, this);
            f.node.on(Node.EventType.TOUCH_START, this._onFieldTap, this);
            if (f.checkBtn) {
                f.checkBtn.off(Node.EventType.TOUCH_START, this._onCheckBtnTap, this);
                f.checkBtn.on(Node.EventType.TOUCH_START, this._onCheckBtnTap, this);
            }
        }

        // Подсказка сразу на первой check-кнопке; после idle — усиление
        this._hintShownOnce = true;
        this._hintActive = true;
        this._moveHint(this._currentIndex);
        this.schedule(this._tickIdle, 0.1);

        // Фоновый звук
        if (this._audioSrc && this.audioChecking) {
            this._audioSrc.clip = this.audioChecking;
            this._audioSrc.loop = false;
            this._audioSrc.play();
        }
    }

    /** Настраиваем anchor FAKEPROGRESSBAR один раз — вызывается из begin() когда Widget уже отработал.
     *
     * FAKEPROGRESSBAR — накладка поверх статичного фона прогресс-бара.
     * Иллюзия заполнения: накладка стартует полной (scale.x=1) и уменьшается слева.
     *
     * Метод: якорь (1, 0.5) → правый край зафиксирован → при scale.x 1→0
     * левый край движется вправо → фон виден слева (бар "заполняется" слева).
     */
    private _setupBarAnchor(): void {
        if (!this.scanBarFill) return;
        const uit = this.scanBarFill.getComponent(UITransform);
        if (!uit || uit.width <= 0) return;

        const halfW = uit.width * 0.5;

        // Сохраняем центральную позицию ДО изменения якоря
        const cx = this.scanBarFill.position.x;
        const cy = this.scanBarFill.position.y;
        const cz = this.scanBarFill.position.z;

        // Переставляем якорь на правый край
        uit.anchorX = 1;
        uit.anchorY = 0.5;

        // Компенсируем сдвиг: правый край = центр + halfW
        this.scanBarFill.setPosition(cx + halfW, cy, cz);

        // Стартуем с полным перекрытием (scale.x = 1)
        this.scanBarFill.setScale(1, 1, 1);
        this._barAnchorReady = true;
    }

    // ── Idle tick ─────────────────────────────────────────────────────────
    private _tickIdle(): void {
        if (this._done) return;
        this._idleTimer += 0.1;
        if (this._idleTimer >= this.hintIdleTime && !this._hintActive) {
            this._hintActive = true;
            if (!this._hintShownOnce) {
                // Первый раз: показать и начать пульсировать мягко
                this._hintShownOnce = true;
                this._moveHint(this._currentIndex);
            } else {
                // Второй+ раз: усилить
                this._intensifyHint();
            }
        }
    }

    private _resetIdle(): void {
        this._idleTimer = 0;
        this._hintActive = false;
        // Скрываем подсказку при нажатии
        this._hideHint();
    }

    // ── Tap ───────────────────────────────────────────────────────────────
    private _onFieldTap(event: EventTouch): void {
        if (this._done) return;
        const target = event.getCurrentTarget() as Node;
        const idx = this._fields.findIndex(f => f.node === target);
        if (idx !== this._currentIndex) return;
        const f = this._fields[idx];
        if (f.state !== FieldState.Idle) return;

        f.state = FieldState.Checking;
        this._resetIdle();

        const isLast = (idx === this._totalFields - 1);
        this._startChecking(f, isLast);
    }

    private _onCheckBtnTap(event: EventTouch): void {
        if (this._done) return;
        event.propagationStopped = true;
        const btn = event.getCurrentTarget() as Node;
        const idx = this._fields.findIndex(f => f.checkBtn === btn);
        if (idx < 0 || idx !== this._currentIndex) return;
        const f = this._fields[idx];
        if (f.state !== FieldState.Idle) return;

        f.state = FieldState.Checking;
        this._resetIdle();

        const isLast = (idx === this._totalFields - 1);
        this._startChecking(f, isLast);
    }

    // ── Смена спрайтов ────────────────────────────────────────────────────

    private _startChecking(f: DocField, isLast: boolean): void {
        const btn = f.checkBtn;
        if (!btn) { this._finishField(f, isLast); return; }

        this._popOut(btn, () => {
            this._setSprite(btn, this.sfInProgress);
            this._popIn(btn, () => {
                this._startLoop(btn);
                // Обычные поля ускоряем; последний (ERROR) — полный checkingDuration + extra
                const delay = isLast
                    ? this.checkingDuration + this.errorExtraDelay
                    : this.checkingDuration * this.normalCheckSpeedMul;
                this.scheduleOnce(() => this._finishField(f, isLast), delay);
            });
        });
    }

    // ── inProgress loop ───────────────────────────────────────────────────
    private _loopTick(): void {
        if (!this._loopRunning || !this._loopBtn || !this._loopBtn.isValid) {
            this._loopRunning = false;
            return;
        }
        this._loopToggle = !this._loopToggle;
        this._setSprite(this._loopBtn, this._loopToggle ? this.sfInProgress2 : this.sfInProgress);
    }

    private _startLoop(btn: Node): void {
        this._stopLoop();
        this._loopBtn = btn;
        this._loopToggle = false;
        this._loopRunning = true;
        this.schedule(this._loopTick, this.inProgressSwapInterval);
    }

    private _stopLoop(): void {
        this._loopRunning = false;
        this._loopBtn = null;
        this.unschedule(this._loopTick);
    }

    // ── Результат поля ────────────────────────────────────────────────────
    private _finishField(f: DocField, isLast: boolean): void {
        const btn = f.checkBtn;
        if (!btn) { this._afterResult(f, isLast); return; }

        this._stopLoop();

        this._popOut(btn, () => {
            const sf = isLast ? this.sfError : this.sfCheck;
            this._setSprite(btn, sf);
            // Принудительно квадратим после смены спрайта
            this._squareNode(btn);
            f.state = isLast ? FieldState.Error : FieldState.Done;
            this._popIn(btn, () => this._afterResult(f, isLast));
        });
    }

    private _afterResult(f: DocField, isLast: boolean): void {
        // Прогресс-бар заполняется одинаково и для check, и для error —
        // чтобы к моменту ошибки бар достигал конца, как при check.
        this._progressStep++;
        this._advanceProgressBar();

        if (!isLast) {
            this._currentIndex++;
            // Следующая check-кнопка — подсказка сразу
            this._idleTimer = 0;
            this._hintActive = true;
            this._hintShownOnce = true;
            this._moveHint(this._currentIndex);
        } else {
            this._triggerWanted();
        }
    }

    // ── Progress bar illusion ─────────────────────────────────────────────
    private _advanceProgressBar(): void {
        if (!this.scanBarFill) return;
        // FAKEPROGRESSBAR — накладка, уменьшается слева (anchor правый).
        // _progressStep / _totalFields = доля пройденного.
        // Накладка: scale.x уменьшается (1 = пусто, 0 = полный прогресс).
        const progress = Math.min(1, this._progressStep / this._totalFields);
        const targetX = 1 - progress;  // scale накладки: 1→0 по мере прогресса
        tween(this.scanBarFill)
            .to(0.25, { scale: new Vec3(targetX, 1, 1) }, { easing: 'sineOut' })
            .start();
    }

    // ── WANTED ────────────────────────────────────────────────────────────
    private _triggerWanted(): void {
        this._done = true;
        this.unschedule(this._tickIdle);
        this._hideHint();

        if (this._audioSrc) this._audioSrc.stop();

        this._showSubtitle('Hands where I can see them! This ends now!', 3.5);

        // Тряска плашки документа (включая дочерние элементы: WantedStamp, check)
        const plaque = this.cardPlaque ?? this.node;
        this._shakeNode(plaque);

        // WantedStamp: появляется чуть позже error-кнопки с анимацией падения сверху
        // (errorExtraDelay уже прошёл внутри checkingDuration, поэтому добавляем ещё 0.4s)
        if (this.wantedStamp) {
            const ws = this.wantedStamp;
            const origPos = ws.position.clone();
            // Стартуем выше на 300 единиц
            ws.setPosition(origPos.x, origPos.y + 300, origPos.z);
            ws.setScale(1.2, 1.2, 1);
            this._setOp(ws, 0);

            this.scheduleOnce(() => {
                tween(ws)
                    .to(0.05, {}, {})  // tiny delay for opacity
                    .call(() => { this._setOp(ws, 255); })
                    .to(0.35, { scale: new Vec3(1.2, 1.2, 1), position: origPos }, { easing: 'sineIn' })
                    .to(0.15, { scale: new Vec3(0.95, 0.95, 1) }, { easing: 'sineOut' })
                    .to(0.1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
                    .start();
            }, 0.5);
        }

        // Красные вспышки (кратковременные)
        this._redFlashLoop();

        // Красная виньетка тревоги — пульсирует в loop (запускаем после завершения вспышек ~1s)
        this.scheduleOnce(() => {
            this._startVignettePulse();
        }, 1.1);

        // Сирена
        this.scheduleOnce(() => {
            if (this._audioSrc && this.audioSiren) {
                this._audioSrc.clip = this.audioSiren;
                this._audioSrc.loop = true;
                this._audioSrc.play();
            }
        }, 0.15);

        // Звук ареста — на родителе (Canvas), чтобы не умирал при hide DocumentCard
        this.scheduleOnce(() => {
            if (!this.audioArrest) return;
            const host = this.node.parent ?? this.node;
            if (!this._arrestAudioSrc || !this._arrestAudioSrc.node || !this._arrestAudioSrc.node.isValid) {
                this._arrestAudioSrc = host.addComponent(AudioSource);
            }
            this._arrestAudioSrc.clip = this.audioArrest;
            this._arrestAudioSrc.loop = false;
            this._arrestAudioSrc.play();
        }, 1.0);

        // Уведомить GameFlowController
        this.scheduleOnce(() => {
            if (this.onWanted) this.onWanted();
        }, 1.8);
    }

    // Прячем WantedStamp вместе с карточкой — вызывается снаружи (или авто при hide)
    public hideWantedStamp(): void {
        if (!this.wantedStamp) return;
        Tween.stopAllByTarget(this.wantedStamp);
        this.wantedStamp.setScale(0, 0, 0);
    }

    private _redFlashLoop(): void {
        if (!this.redFlash) return;
        const rf = this.redFlash;
        let op = rf.getComponent(UIOpacity);
        if (!op) op = rf.addComponent(UIOpacity);
        let count = 0;
        const flash = () => {
            if (count >= 4) { op!.opacity = 0; return; }
            count++;
            tween(op!)
                .to(0.08, { opacity: 200 })
                .to(0.14, { opacity: 0 })
                .call(flash)
                .start();
        };
        flash();
    }

    /** Пульсирующая виньетка тревоги — мягко, бесконечно */
    private _startVignettePulse(): void {
        const rv = this.redVignette ?? this.redFlash;
        if (!rv) return;
        this._vignetteRunning = true;
        let op = rv.getComponent(UIOpacity);
        if (!op) op = rv.addComponent(UIOpacity);
        op.opacity = 0;
        tween(op)
            .repeatForever(
                tween(op)
                    .to(0.6, { opacity: 160 }, { easing: 'sineInOut' })
                    .to(0.6, { opacity: 30 }, { easing: 'sineInOut' })
            )
            .start();
    }

    public stopVignette(): void {
        const rv = this.redVignette ?? this.redFlash;
        if (!rv) return;
        const op = rv.getComponent(UIOpacity);
        if (op) Tween.stopAllByTarget(op);
        this._setOp(rv, 0);
        this._vignetteRunning = false;
    }

    // ── Finger hint ───────────────────────────────────────────────────────
    /** Ставит руку на центр check + hintOffsetX/Y из Inspector. */
    private _moveHint(idx: number): void {
        if (!this.fingerHint || idx >= this._fields.length) return;
        const field = this._fields[idx];
        const target = field.checkBtn ?? field.node;
        this.fingerHint.active = true;
        this.fingerHint.setScale(1, 1, 1);

        const worldPos = target.getWorldPosition();
        const hintParent = this.fingerHint.parent;
        let localX = worldPos.x;
        let localY = worldPos.y;
        if (hintParent) {
            const localVec = new Vec3();
            hintParent.inverseTransformPoint(localVec, worldPos);
            localX = localVec.x;
            localY = localVec.y;
        }

        Tween.stopAllByTarget(this.fingerHint);
        this.fingerHint.setPosition(localX + this.hintOffsetX, localY + this.hintOffsetY, 0);
        this._loopPulse();
    }

    /** Пульсирующая анимация scale 1→1.15→1 (мягко, бесконечно) */
    private _loopPulse(): void {
        if (!this.fingerHint || !this.fingerHint.active) return;
        Tween.stopAllByTarget(this.fingerHint);
        const fh = this.fingerHint;
        fh.setScale(1, 1, 1);
        tween(fh)
            .repeatForever(
                tween(fh)
                    .to(0.45, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'sineOut' })
                    .to(0.45, { scale: new Vec3(1.0,  1.0,  1) }, { easing: 'sineIn' })
            )
            .start();
    }

    /** Усиленный пульс при долгом ожидании — более заметный */
    private _intensifyHint(): void {
        if (!this.fingerHint) return;
        if (!this.fingerHint.active) {
            this._moveHint(this._currentIndex);
            return;
        }
        Tween.stopAllByTarget(this.fingerHint);
        const fh = this.fingerHint;
        fh.setScale(1, 1, 1);
        tween(fh)
            .repeatForever(
                tween(fh)
                    .to(0.25, { scale: new Vec3(1.25, 1.25, 1) }, { easing: 'sineOut' })
                    .to(0.25, { scale: new Vec3(0.9,  0.9,  1) }, { easing: 'sineIn' })
            )
            .start();
    }

    private _hideHint(): void {
        if (!this.fingerHint) return;
        Tween.stopAllByTarget(this.fingerHint);
        this.fingerHint.active = false;
        this.fingerHint.setScale(1, 1, 1);
    }

    // ── Pop-out / Pop-in ──────────────────────────────────────────────────
    private _popOut(node: Node, done: () => void): void {
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = 255;
        node.setScale(1, 1, 1);
        tween(node)
            .to(0.08, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'sineOut' })
            .to(0.12, { scale: new Vec3(0, 0, 1) }, { easing: 'sineIn' })
            .call(() => { this._setOp(node, 0); done(); })
            .start();
    }

    private _popIn(node: Node, done: () => void): void {
        this._setOp(node, 255);
        node.setScale(0, 0, 1);
        tween(node)
            .to(0.14, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
            .to(0.1, { scale: new Vec3(1, 1, 1) }, { easing: 'sineIn' })
            .call(() => done())
            .start();
    }

    // ── Квадратизация кнопки ──────────────────────────────────────────────
    /** Принудительно делает ноду квадратной по меньшей стороне */
    private _squareNode(node: Node): void {
        const uit = node.getComponent(UITransform);
        if (!uit) return;
        const side = Math.min(uit.width, uit.height);
        if (side > 0) {
            uit.setContentSize(side, side);
        }
    }

    // ── Тряска ───────────────────────────────────────────────────────────
    /** Тряска ноды — теперь трясём весь DocumentCard (node) целиком,
     *  поэтому WantedStamp и check-кнопки тоже трясутся как дочерние */
    private _shakeNode(node: Node): void {
        const orig = node.position.clone();
        const d = 8;
        tween(node)
            .by(0.04, { position: new Vec3(d, 0, 0) })
            .by(0.04, { position: new Vec3(-d * 2, 0, 0) })
            .by(0.04, { position: new Vec3(d * 2, 0, 0) })
            .by(0.04, { position: new Vec3(-d * 2, 0, 0) })
            .by(0.04, { position: new Vec3(d * 2, 0, 0) })
            .by(0.04, { position: new Vec3(-d, 0, 0) })
            .to(0.06, { position: orig })
            .start();
    }

    // ── Субтитры ──────────────────────────────────────────────────────────
    private _showSubtitle(text: string, duration: number): void {
        if (!this.subtitle) return;
        const lbl = this.subtitle;
        // Поверх DocumentCard
        const parent = lbl.node.parent;
        if (parent) lbl.node.setSiblingIndex(parent.children.length - 1);
        lbl.string = text;
        lbl.node.active = true;
        this._setOp(lbl.node, 0);
        let op = lbl.node.getComponent(UIOpacity);
        if (!op) op = lbl.node.addComponent(UIOpacity);
        tween(op)
            .to(0.3, { opacity: 255 })
            .delay(duration)
            .to(0.4, { opacity: 0 })
            .call(() => { lbl.node.active = false; })
            .start();
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    private _setSprite(node: Node, sf: SpriteFrame | null): void {
        if (!sf) return;
        const sp = node.getComponent(Sprite);
        if (sp) sp.spriteFrame = sf;
    }

    private _setOp(node: Node, a: number): void {
        let op = node.getComponent(UIOpacity);
        if (!op) op = node.addComponent(UIOpacity);
        op.opacity = a;
    }

    /** Остановить только сирену/виньетку. Звук ареста НЕ трогаем. */
    public stopSiren(): void {
        if (this._audioSrc) this._audioSrc.stop();
        this.stopVignette();
    }
}

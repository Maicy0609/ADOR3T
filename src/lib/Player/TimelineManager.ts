import { Vector2, Vector3, Euler, Mesh, ShaderMaterial } from 'three';
import { getEasingFunction } from './WasmEasing';
import { isEventActive, isFieldEnabled } from './EventUtils';

export interface Keyframe {
    time: number;
    value: number;
    ease: string | null;
}

export class TimelineManager {
    private timelines: Map<string, Map<string, Keyframe[]>> = new Map();
    private triggerEvents: { time: number; event: any }[] = [];
    private lastTriggerIndex: number = -1;

    private tileStartTimes: number[];
    private tileBPM: number[];
    private totalTiles: number;

    constructor(
        actions: any[],
        tileStartTimes: number[],
        tileBPM: number[],
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
        totalTiles: number,
        settings?: any,
    ) {
        this.tileStartTimes = tileStartTimes;
        this.tileBPM = tileBPM;
        this.totalTiles = totalTiles;
        this.build(actions, basePositions, baseRotations, baseScales, baseOpacities, settings);
    }

    private build(
        actions: any[],
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
        settings?: any,
    ): void {
        const perTileMoveTrack: Map<number, {
            time: number; duration: number; event: any; floor: number
        }[]> = new Map();

        const triggerEntries: { time: number; event: any }[] = [];

        // Collect MoveTrack events per floor, then sort by id to match C# order
        const perFloorMoveTrack: Map<number, any[]> = new Map();
        for (const action of actions) {
            if (!isEventActive(action)) continue;
            if (action.eventType === 'MoveTrack') {
                const floor = action.floor ?? 0;
                if (!perFloorMoveTrack.has(floor)) perFloorMoveTrack.set(floor, []);
                perFloorMoveTrack.get(floor)!.push(action);
            }
        }
        for (const [, evts] of perFloorMoveTrack) {
            evts.sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity));
        }

        const zeroOffsetTracker: Map<number, number> = new Map();

        for (const action of actions) {
            if (!isEventActive(action)) continue;

            const floor = action.floor ?? 0;
            const bpm = this.tileBPM[floor] || 100;
            const secPerBeat = 60 / bpm;
            const startTime = this.tileStartTimes[floor] || 0;
            const angleOffset = action.angleOffset || 0;
            let timeOffset = (angleOffset / 180) * secPerBeat;

            if (action.eventType === 'MoveTrack' && angleOffset === 0) {
                const idSorted = perFloorMoveTrack.get(floor) ?? [];
                const order = idSorted.findIndex(e => e.id === action.id);
                if (order > 0) timeOffset += order * 0.0001;
            }

            const eventTime = startTime + timeOffset;

            if (action.eventType === 'MoveTrack') {
                const startTile = this.parseTileReference(action.startTile, floor);
                const endTile = this.parseTileReference(action.endTile, floor);
                const start = Math.min(startTile, endTile);
                const end = Math.max(startTile, endTile);
                const gapLength = action.gapLength || 0;
                const rawDuration = (action.duration ?? 1) * secPerBeat;
                const duration = rawDuration || 1;

                for (let i = start; i <= end; i += 1 + gapLength) {
                    if (i < 0) continue;
                    if (!perTileMoveTrack.has(i)) perTileMoveTrack.set(i, []);
                    perTileMoveTrack.get(i)!.push({
                        time: eventTime, duration, event: action, floor,
                    });
                }
            } else if (action.eventType !== 'MoveCamera' &&
                       action.eventType !== 'SetHitsound' &&
                       action.eventType !== 'PlayHitsound') {
                triggerEntries.push({ time: eventTime, event: action });
            }
        }

        triggerEntries.sort((a, b) => {
            const dt = a.time - b.time;
            return Math.abs(dt) < 0.0001
                ? ((a.event.id ?? Infinity) - (b.event.id ?? Infinity))
                : (dt > 0 ? 1 : -1);
        });
        this.triggerEvents = triggerEntries;

        // Build Appear/Disappear keyframes FIRST from AnimateTrack events,
        // then MoveTrack SECOND so MoveTrack opacity/position/scale can override them.
        this.buildAnimateTrackKeyframes(actions, basePositions, baseRotations, baseScales, baseOpacities, settings);

        for (const [tileIdx, events] of perTileMoveTrack) {
            events.sort((a, b) => {
                const dt = a.time - b.time;
                if (Math.abs(dt) < 0.0001) return (a.event.id ?? Infinity) - (b.event.id ?? Infinity);
                return dt > 0 ? 1 : -1;
            });
            this.buildTileMoveTrack(tileIdx, events, basePositions, baseRotations, baseScales, baseOpacities, tileIdx < this.tileStartTimes.length ? this.tileStartTimes[tileIdx] : 0);
        }
    }

    private buildTileMoveTrack(
        tileIdx: number,
        events: { time: number; duration: number; event: any; floor: number }[],
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
        tileStartTime: number,
    ): void {
        const baseX = tileIdx >= 0 && tileIdx < basePositions.length ? basePositions[tileIdx].x : 0;
        const baseY = tileIdx >= 0 && tileIdx < basePositions.length ? basePositions[tileIdx].y : 0;
        const baseRot = tileIdx >= 0 && tileIdx < baseRotations.length ? baseRotations[tileIdx] : 0;
        const baseSX = tileIdx >= 0 && tileIdx < baseScales.length ? baseScales[tileIdx].x : 1;
        const baseSY = tileIdx >= 0 && tileIdx < baseScales.length ? baseScales[tileIdx].y : 1;
        const baseOp = tileIdx >= 0 && tileIdx < baseOpacities.length ? baseOpacities[tileIdx] : 1;

        this.addKeyframe(`tile:${tileIdx}`, 'positionX', 0, baseX, null);
        this.addKeyframe(`tile:${tileIdx}`, 'positionY', 0, baseY, null);
        this.addKeyframe(`tile:${tileIdx}`, 'rotation', 0, baseRot, null);
        this.addKeyframe(`tile:${tileIdx}`, 'scaleX', 0, baseSX, null);
        this.addKeyframe(`tile:${tileIdx}`, 'scaleY', 0, baseSY, null);
        this.addKeyframe(`tile:${tileIdx}`, 'opacity', 0, baseOp, null);

        let accX = baseX, accY = baseY, accRot = baseRot, accSX = baseSX, accSY = baseSY, accOp = baseOp;

        for (const entry of events) {
            const { event, time: eventTime, duration: eventDuration, floor } = entry;

            const positionUsed = event.positionOffset !== undefined && isFieldEnabled(event, 'positionOffset');
            const rotationUsed = event.rotationOffset !== undefined && isFieldEnabled(event, 'rotationOffset');
            const scaleUsed = event.scale !== undefined && isFieldEnabled(event, 'scale');
            const opacityUsed = event.opacity != null && isFieldEnabled(event, 'opacity');

            const ease = event.ease || 'Linear.easeNone';

            const offsetX = positionUsed && event.positionOffset[0] != null ? event.positionOffset[0] : null;
            const offsetY = positionUsed && event.positionOffset[1] != null ? event.positionOffset[1] : null;

            let rotationOffset: number | null = null;
            if (rotationUsed) rotationOffset = (event.rotationOffset || 0) * Math.PI / 180;

            let scaleX: number | null = null, scaleY: number | null = null;
            if (scaleUsed && event.scale) {
                if (Array.isArray(event.scale)) {
                    scaleX = event.scale[0] != null ? event.scale[0] / 100 : null;
                    scaleY = event.scale[1] != null ? event.scale[1] / 100 : null;
                } else {
                    scaleX = scaleY = event.scale / 100;
                }
            }

            const opacity = opacityUsed ? event.opacity / 100 : null;

            const targetX = offsetX != null ? baseX + offsetX : accX;
            const targetY = offsetY != null ? baseY + offsetY : accY;
            const targetRot = rotationOffset != null ? baseRot + rotationOffset : accRot;
            const targetSX = scaleX != null ? scaleX : accSX;
            const targetSY = scaleY != null ? scaleY : accSY;
            const targetOp = opacity != null ? opacity : accOp;

            if (eventDuration <= 0) {
                if (offsetX != null) this.instantKeyframe(`tile:${tileIdx}`, 'positionX', eventTime, targetX);
                if (offsetY != null) this.instantKeyframe(`tile:${tileIdx}`, 'positionY', eventTime, targetY);
                if (rotationOffset != null) this.instantKeyframe(`tile:${tileIdx}`, 'rotation', eventTime, targetRot);
                if (scaleX != null) this.instantKeyframe(`tile:${tileIdx}`, 'scaleX', eventTime, targetSX);
                if (scaleY != null) this.instantKeyframe(`tile:${tileIdx}`, 'scaleY', eventTime, targetSY);
                if (opacity != null) this.instantKeyframe(`tile:${tileIdx}`, 'opacity', eventTime, targetOp);
            } else {
                const endTime = eventTime + eventDuration;
                const props: [string, number][] = [];
                if (offsetX != null) props.push(['positionX', targetX]);
                if (offsetY != null) props.push(['positionY', targetY]);
                if (rotationOffset != null) props.push(['rotation', targetRot]);
                if (scaleX != null) props.push(['scaleX', targetSX]);
                if (scaleY != null) props.push(['scaleY', targetSY]);
                if (opacity != null) props.push(['opacity', targetOp]);

                for (const [prop, target] of props) {
                    const kfs = this.timelines.get(`tile:${tileIdx}`)!.get(prop)!;
                    const prevIdx = this.findKeyframeIndex(kfs, eventTime);
                    const startVal = prevIdx >= 0
                        ? this.interpolateTimeline(kfs, prevIdx, eventTime)
                        : kfs[0]?.value ?? 0;

                    this.removeAfter(kfs, eventTime + 1e-9);

                    kfs.push({ time: eventTime, value: startVal, ease: ease });
                    kfs.push({ time: endTime, value: target, ease: null });
                    if (kfs.length > 1) kfs.sort((a, b) => a.time - b.time);
                }
            }

            if (offsetX != null) accX = targetX;
            if (offsetY != null) accY = targetY;
            if (rotationOffset != null) accRot = targetRot;
            if (scaleX != null) accSX = targetSX;
            if (scaleY != null) accSY = targetSY;
            if (opacity != null) accOp = targetOp;
        }
    }

    private ensureTimeline(entity: string, property: string): Keyframe[] {
        let props = this.timelines.get(entity);
        if (!props) {
            props = new Map();
            this.timelines.set(entity, props);
        }
        let kfs = props.get(property);
        if (!kfs) {
            kfs = [];
            props.set(property, kfs);
        }
        return kfs;
    }

    private instantKeyframe(entity: string, property: string, time: number, value: number): void {
        const kfs = this.timelines.get(entity)?.get(property);
        if (!kfs) return;

        this.removeAfter(kfs, time + 1e-9);
        const idx = this.findKeyframeIndex(kfs, time);
        if (idx >= 0 && Math.abs(kfs[idx].time - time) < 1e-9) {
            kfs[idx].value = value;
            kfs[idx].ease = null;
        } else {
            kfs.push({ time, value, ease: null });
            kfs.sort((a, b) => a.time - b.time);
        }
    }

    private removeAfter(kfs: Keyframe[], time: number): void {
        for (let i = kfs.length - 1; i >= 0; i--) {
            if (kfs[i].time >= time) kfs.splice(i, 1);
        }
    }

    private findKeyframeIndex(kfs: Keyframe[], time: number): number {
        if (kfs.length === 0) return -1;
        let lo = 0, hi = kfs.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (kfs[mid].time < time) lo = mid + 1;
            else if (kfs[mid].time > time) hi = mid - 1;
            else return mid;
        }
        return hi;
    }

    /* ── 公开 API ────────────────────────────────────────────────── */

    public sample(entity: string, property: string, time: number): number | undefined {
        const kfs = this.timelines.get(entity)?.get(property);
        if (!kfs || kfs.length === 0) return undefined;

        if (kfs.length === 1) return kfs[0].value;

        const idx = this.findKeyframeIndex(kfs, time);
        if (idx < 0) return kfs[0].value;
        if (idx >= kfs.length - 1) return kfs[kfs.length - 1].value;

        const left = kfs[idx];
        const right = kfs[idx + 1];
        return this.interpolateTimelinePair(left, right, time);
    }

    public sampleStep(entity: string, property: string, time: number): number | undefined {
        const kfs = this.timelines.get(entity)?.get(property);
        if (!kfs || kfs.length === 0) return undefined;
        const idx = this.findKeyframeIndex(kfs, time);
        if (idx < 0) return kfs[0].value;
        return kfs[idx].value;
    }

    public samplePosition(entity: string, time: number): { x: number; y: number } | null {
        const x = this.sample(entity, 'positionX', time);
        const y = this.sample(entity, 'positionY', time);
        if (x === undefined || y === undefined) return null;
        return { x, y };
    }

    private interpolateTimeline(kfs: Keyframe[], idx: number, time: number): number {
        const left = kfs[idx];
        if (idx >= kfs.length - 1) return left.value;
        return this.interpolateTimelinePair(left, kfs[idx + 1], time);
    }

    private interpolateTimelinePair(left: Keyframe, right: Keyframe, time: number): number {
        if (time <= left.time) return left.value;
        if (time >= right.time) return right.value;

        const range = right.time - left.time;
        if (range <= 1e-12) return right.value;

        let progress = (time - left.time) / range;
        if (left.ease && left.ease !== 'Linear.easeNone' && left.ease !== 'Linear') {
            const fn = getEasingFunction(left.ease);
            progress = fn(progress);
        }

        return left.value + (right.value - left.value) * progress;
    }

    public *sampleAllPosition(time: number): IterableIterator<[number, { x: number; y: number }]> {
        for (const [entity, props] of this.timelines) {
            if (!entity.startsWith('tile:')) continue;
            const tileIdx = parseInt(entity.slice(5), 10);
            if (isNaN(tileIdx)) continue;
            const pos = this.samplePosition(entity, time);
            if (pos) yield [tileIdx, pos];
        }
    }

    public isRewound(time: number): boolean {
        return this.lastTriggerIndex >= 0 &&
               time < this.triggerEvents[this.lastTriggerIndex]?.time;
    }

    public getTriggered(time: number): any[] {
        if (this.isRewound(time)) {
            this.reset();
            return [];
        }
        const result: any[] = [];
        while (
            this.lastTriggerIndex + 1 < this.triggerEvents.length &&
            this.triggerEvents[this.lastTriggerIndex + 1].time <= time
        ) {
            this.lastTriggerIndex++;
            result.push(this.triggerEvents[this.lastTriggerIndex].event);
        }
        return result;
    }

    public hasTimeline(entity: string, property: string): boolean {
        return !!this.timelines.get(entity)?.has(property);
    }

    public reset(): void {
        this.lastTriggerIndex = -1;
    }

    public getAllTileIndices(): Set<number> {
        const indices = new Set<number>();
        for (const entity of this.timelines.keys()) {
            if (!entity.startsWith('tile:')) continue;
            const idx = parseInt(entity.slice(5), 10);
            if (!isNaN(idx)) indices.add(idx);
        }
        return indices;
    }

    /**
     * Returns true if any property of this tile has keyframes that span
     * across the given time — meaning the tile's values can change at this time.
     * If all keyframes are entirely before or after `time`, the tile is static.
     */
    public isTileActive(tileIdx: number, time: number): boolean {
        const props = this.timelines.get(`tile:${tileIdx}`);
        if (!props) return false;
        for (const kfs of props.values()) {
            if (kfs.length < 2) continue;
            if (time < kfs[kfs.length - 1].time) return true;
        }
        return false;
    }

    /* ── 通用 keyframe 添加（给 Camera/Decoration 用） ────────────── */

    public addKeyframe(entity: string, property: string, time: number, value: number, ease: string | null): void {
        const kfs = this.ensureTimeline(entity, property);
        const prevIdx = this.findKeyframeIndex(kfs, time);
        if (prevIdx >= 0 && Math.abs(kfs[prevIdx].time - time) < 1e-9) {
            kfs[prevIdx].value = value;
            kfs[prevIdx].ease = ease;
            return;
        }
        kfs.push({ time, value, ease });
        if (kfs.length > 1) kfs.sort((a, b) => a.time - b.time);
    }

    public addTween(entity: string, property: string, startTime: number, endTime: number, startValue: number, endValue: number, ease: string): void {
        const kfs = this.ensureTimeline(entity, property);
        const prevIdx = this.findKeyframeIndex(kfs, startTime);
        const actualStart = prevIdx >= 0
            ? this.interpolateTimeline(kfs, prevIdx, startTime)
            : (kfs[0]?.value ?? startValue);
        this.removeAfter(kfs, startTime + 1e-9);
        kfs.push({ time: startTime, value: actualStart, ease });
        kfs.push({ time: endTime, value: endValue, ease: null });
        if (kfs.length > 1) kfs.sort((a, b) => a.time - b.time);
    }

    /* ── 查询所有 entity 类型 ─────────────────────────────────────── */

    public getAllEntitiesByPrefix(prefix: string): string[] {
        const result: string[] = [];
        for (const entity of this.timelines.keys()) {
            if (entity.startsWith(prefix)) result.push(entity);
        }
        return result;
    }

    /* ── 工具 ────────────────────────────────────────────────────── */

    private parseTileReference(ref: any, currentFloor: number): number {
        if (Array.isArray(ref) && ref.length >= 2) {
            const offset = Number(ref[0]) || 0;
            const relativeTo = ref[1];
            if (relativeTo === 'ThisTile' || relativeTo === 0) {
                return currentFloor + offset;
            } else if (relativeTo === 'Start' || relativeTo === 1) {
                return offset;
            } else if (relativeTo === 'End' || relativeTo === 2) {
                    return (this.totalTiles - 1) + offset;
            }
        }
        return Number(ref) || currentFloor;
    }

    /* ── 批量应用到 mesh ─────────────────────────────────────────── */

    public applyToTileMesh(tileIdx: number, mesh: Mesh, time: number): boolean {
        const entity = `tile:${tileIdx}`;
        let dirty = false;

        const x = this.sample(entity, 'positionX', time);
        const y = this.sample(entity, 'positionY', time);
        const rot = this.sample(entity, 'rotation', time);
        const sx = this.sample(entity, 'scaleX', time);
        const sy = this.sample(entity, 'scaleY', time);
        const op = this.sample(entity, 'opacity', time);

        if (x !== undefined) { mesh.position.x = x; dirty = true; }
        if (y !== undefined) { mesh.position.y = y; dirty = true; }
        if (rot !== undefined) { mesh.rotation.z = rot; dirty = true; }
        if (sx !== undefined) { mesh.scale.x = sx; dirty = true; }
        if (sy !== undefined) { mesh.scale.y = sy; dirty = true; }
        if (op !== undefined) {
            mesh.userData.opacity = op;
            if (mesh.material) {
                if (mesh.material instanceof ShaderMaterial && mesh.material.uniforms?.opacity) {
                    mesh.material.uniforms.opacity.value = op;
                } else {
                    (mesh.material as any).opacity = op;
                }
                (mesh.material as any).transparent = op < 0.999;
            }
            mesh.visible = op > 0.001;
            mesh.traverse((child) => {
                if (child !== mesh && (child as any).material?.opacity !== undefined) {
                    (child as any).material.opacity = op;
                }
            });
            dirty = true;
        }

        return dirty;
    }

    /* ── AnimateTrack (Appear/Disappear) ─────────────────────────── */

    private buildAnimateTrackKeyframes(
        actions: any[],
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
        settings?: any,
    ): void {
        const animateTrackEvents: { floor: number; event: any; id: number }[] = [];
        for (const action of actions) {
            if (!isEventActive(action)) continue;
            if (action.eventType === 'AnimateTrack') {
                animateTrackEvents.push({
                    floor: action.floor ?? 0,
                    event: action,
                    id: action.id ?? Infinity,
                });
            }
        }
        animateTrackEvents.sort((a, b) => {
            if (a.floor !== b.floor) return a.floor - b.floor;
            return a.id - b.id;
        });

        let appearType: string = settings?.trackAnimation || 'None';
        let disappearType: string = settings?.trackDisappearAnimation || 'None';
        let beatsAhead: number = settings?.beatsAhead ?? 3;
        let beatsBehind: number = settings?.beatsBehind ?? 4;

        // C# ApplyEventsToFloors speed ratio tracking (num5/num6)
        // num5 = tileBPM at the AT event before the most recent
        // num6 = tileBPM at the most recent AT event
        // flag2 = whether the most recent AT event had trackAnimation enabled
        const baseTileBPM = this.tileBPM[0] || 100;
        let num5 = baseTileBPM;
        let num6 = baseTileBPM;
        let flag2 = false;

        let eventIdx = 0;
        for (let floor = 0; floor < this.totalTiles; floor++) {
            let hadAnimateTrack = false;
            let floorFlag2 = false;

            while (eventIdx < animateTrackEvents.length && animateTrackEvents[eventIdx].floor === floor) {
                const evt = animateTrackEvents[eventIdx].event;
                const hasTrackAnim = isFieldEnabled(evt, 'trackAnimation');
                const hasTrackDisappear = isFieldEnabled(evt, 'trackDisappearAnimation');

                if (hasTrackAnim) {
                    appearType = evt.trackAnimation || 'None';
                    if (evt.beatsAhead != null) beatsAhead = evt.beatsAhead;
                }
                if (hasTrackDisappear) {
                    disappearType = evt.trackDisappearAnimation || 'None';
                    if (evt.beatsBehind != null) beatsBehind = evt.beatsBehind;
                }

                // Update flag2 from this AT event (always, per C#)
                floorFlag2 = hasTrackAnim;
                hadAnimateTrack = true;
                eventIdx++;
            }

            if (hadAnimateTrack) {
                num5 = num6;
                num6 = this.tileBPM[floor] || baseTileBPM;
                flag2 = floorFlag2;
            }

            // Speed ratio scaling: beatsAhead *= speed / (flag2 ? num6 : num5)
            const speed = this.tileBPM[floor] || baseTileBPM;
            const refBPM = flag2 ? num6 : num5;
            const speedRatio = speed / refBPM;
            const scaledBeatsAhead = beatsAhead * speedRatio;
            const scaledBeatsBehind = beatsBehind * speedRatio;

            if (appearType !== 'None' && scaledBeatsAhead > 0) {
                this.buildAppearKeyframes(floor, appearType, scaledBeatsAhead, basePositions, baseRotations, baseScales, baseOpacities);
            }
            if (disappearType !== 'None' && scaledBeatsBehind > 0 && floor < this.totalTiles - 1) {
                const nextEntryTime = this.tileStartTimes[floor + 1] ?? 0;
                this.buildDisappearKeyframes(floor, disappearType, scaledBeatsBehind, nextEntryTime, basePositions, baseRotations, baseScales, baseOpacities);
            }
        }
    }

    private buildAppearKeyframes(
        floor: number,
        animType: string,
        beatsAhead: number,
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
    ): void {
        const entryTime = this.tileStartTimes[floor] || 0;
        const bpm = this.tileBPM[floor] || 100;
        const secPerBeat = 60 / bpm;

        const isDropOrRise = animType === 'Drop' || animType === 'Rise';
        const tiles = isDropOrRise ? beatsAhead * 2 : beatsAhead;
        const appearStartTime = Math.max(entryTime - tiles * secPerBeat, 0);

        // Don't generate appear keyframes that start at/before time 0 —
        // At time 0 the tile should be in its base state for preview.
        if (appearStartTime <= 0) return;
        const appearDuration = isDropOrRise
            ? secPerBeat * beatsAhead
            : Math.min(secPerBeat * 0.5, 0.5);
        const appearEndTime = appearStartTime + appearDuration;

        const baseX = basePositions[floor]?.x ?? 0;
        const baseY = basePositions[floor]?.y ?? 0;
        const baseRot = baseRotations[floor] ?? 0;
        const baseSX = baseScales[floor]?.x ?? 1;
        const baseSY = baseScales[floor]?.y ?? 1;
        const baseOp = baseOpacities[floor] ?? 1;

        const entity = `tile:${floor}`;
        const ease = isDropOrRise ? 'Linear.easeNone' : 'Quad.easeOut';

        // Add pre-keyframes at appearStartTime - epsilon so sample()
        // returns base values right before the animation starts.
        // Without these, sample interpolates from time 0 → appearStartTime,
        // making tiles semi-transparent/invisible before their animation.
        const preTime = appearStartTime - 1e-7;
        this.addKeyframe(entity, 'positionX', preTime, baseX, null);
        this.addKeyframe(entity, 'positionY', preTime, baseY, null);
        this.addKeyframe(entity, 'rotation', preTime, baseRot, null);
        this.addKeyframe(entity, 'scaleX', preTime, baseSX, null);
        this.addKeyframe(entity, 'scaleY', preTime, baseSY, null);
        this.addKeyframe(entity, 'opacity', preTime, baseOp, null);

        switch (animType) {
            case 'Extend': {
                const prevX = floor > 0 ? (basePositions[floor - 1]?.x ?? baseX) : baseX;
                const prevY = floor > 0 ? (basePositions[floor - 1]?.y ?? baseY) : baseY;
                this.instantKeyframe(entity, 'positionX', appearStartTime, prevX);
                this.instantKeyframe(entity, 'positionY', appearStartTime, prevY);
                this.instantKeyframe(entity, 'scaleX', appearStartTime, 0);
                this.instantKeyframe(entity, 'scaleY', appearStartTime, 0);
                this.addTween(entity, 'positionX', appearStartTime, appearEndTime, prevX, baseX, ease);
                this.addTween(entity, 'positionY', appearStartTime, appearEndTime, prevY, baseY, ease);
                this.addTween(entity, 'scaleX', appearStartTime, appearEndTime, 0, baseSX, ease);
                this.addTween(entity, 'scaleY', appearStartTime, appearEndTime, 0, baseSY, ease);
                break;
            }
            case 'Assemble':
            case 'Assemble_Far': {
                const range = animType === 'Assemble_Far' ? 8 : 4;
                const rotRange = 75;
                const seed = floor * 7919;
                const dx = this.seededRandom(seed) * range * 2 - range;
                const dy = this.seededRandom(seed + 1) * range * 2 - range;
                const dr = (this.seededRandom(seed + 2) * rotRange * 2 - rotRange) * Math.PI / 180;
                this.instantKeyframe(entity, 'positionX', appearStartTime, baseX + dx);
                this.instantKeyframe(entity, 'positionY', appearStartTime, baseY + dy);
                this.instantKeyframe(entity, 'rotation', appearStartTime, baseRot + dr);
                this.addTween(entity, 'positionX', appearStartTime, appearEndTime, baseX + dx, baseX, ease);
                this.addTween(entity, 'positionY', appearStartTime, appearEndTime, baseY + dy, baseY, ease);
                this.addTween(entity, 'rotation', appearStartTime, appearEndTime, baseRot + dr, baseRot, ease);
                break;
            }
            case 'Grow': {
                this.instantKeyframe(entity, 'scaleX', appearStartTime, 0);
                this.instantKeyframe(entity, 'scaleY', appearStartTime, 0);
                this.addTween(entity, 'scaleX', appearStartTime, appearEndTime, 0, baseSX, ease);
                this.addTween(entity, 'scaleY', appearStartTime, appearEndTime, 0, baseSY, ease);
                break;
            }
            case 'Grow_Spin': {
                this.instantKeyframe(entity, 'scaleX', appearStartTime, 0);
                this.instantKeyframe(entity, 'scaleY', appearStartTime, 0);
                this.instantKeyframe(entity, 'rotation', appearStartTime, baseRot - Math.PI);
                this.addTween(entity, 'scaleX', appearStartTime, appearEndTime, 0, baseSX, ease);
                this.addTween(entity, 'scaleY', appearStartTime, appearEndTime, 0, baseSY, ease);
                this.addTween(entity, 'rotation', appearStartTime, appearEndTime, baseRot - Math.PI, baseRot, ease);
                break;
            }
            case 'Fade': {
                this.instantKeyframe(entity, 'opacity', appearStartTime, 0);
                this.addTween(entity, 'opacity', appearStartTime, appearEndTime, 0, baseOp, ease);
                break;
            }
            case 'Drop': {
                const scaleDur = appearDuration / 8;
                this.instantKeyframe(entity, 'positionY', appearStartTime, baseY + 8);
                this.instantKeyframe(entity, 'scaleX', appearStartTime, 0);
                this.instantKeyframe(entity, 'scaleY', appearStartTime, 0);
                this.addTween(entity, 'positionY', appearStartTime, appearEndTime, baseY + 8, baseY, ease);
                this.addTween(entity, 'scaleX', appearStartTime, appearStartTime + scaleDur, 0, baseSX, 'Quad.easeOut');
                this.addTween(entity, 'scaleY', appearStartTime, appearStartTime + scaleDur, 0, baseSY, 'Quad.easeOut');
                break;
            }
            case 'Rise': {
                const scaleDur = appearDuration / 8;
                this.instantKeyframe(entity, 'positionY', appearStartTime, baseY - 8);
                this.instantKeyframe(entity, 'scaleX', appearStartTime, 0);
                this.instantKeyframe(entity, 'scaleY', appearStartTime, 0);
                this.addTween(entity, 'positionY', appearStartTime, appearEndTime, baseY - 8, baseY, ease);
                this.addTween(entity, 'scaleX', appearStartTime, appearStartTime + scaleDur, 0, baseSX, 'Quad.easeOut');
                this.addTween(entity, 'scaleY', appearStartTime, appearStartTime + scaleDur, 0, baseSY, 'Quad.easeOut');
                break;
            }
        }
    }

    private buildDisappearKeyframes(
        floor: number,
        animType: string,
        beatsBehind: number,
        nextEntryTime: number,
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
    ): void {
        const bpm = this.tileBPM[floor] || 100;
        const secPerBeat = 60 / bpm;
        const disappearStartTime = nextEntryTime + beatsBehind * secPerBeat;
        const disappearDuration = Math.min(secPerBeat * 0.5, 0.5);
        const disappearEndTime = disappearStartTime + disappearDuration;

        const baseX = basePositions[floor]?.x ?? 0;
        const baseY = basePositions[floor]?.y ?? 0;
        const baseRot = baseRotations[floor] ?? 0;
        const baseSX = baseScales[floor]?.x ?? 1;
        const baseSY = baseScales[floor]?.y ?? 1;
        const baseOp = baseOpacities[floor] ?? 1;

        const entity = `tile:${floor}`;
        const ease = 'Quad.easeOut';

        switch (animType) {
            case 'Scatter':
            case 'Scatter_Far': {
                const range = animType === 'Scatter_Far' ? 8 : 4;
                const seed = floor * 3571 + 1000;
                const dx = this.seededRandom(seed) * range * 2 - range;
                const dy = this.seededRandom(seed + 1) * range * 2 - range;
                const dr = (this.seededRandom(seed + 2) * 150 - 75) * Math.PI / 180;
                this.addTween(entity, 'positionX', disappearStartTime, disappearEndTime, baseX, baseX + dx, ease);
                this.addTween(entity, 'positionY', disappearStartTime, disappearEndTime, baseY, baseY + dy, ease);
                this.addTween(entity, 'rotation', disappearStartTime, disappearEndTime, baseRot, baseRot + dr, ease);
                break;
            }
            case 'Retract': {
                const nextX = basePositions[floor + 1]?.x ?? baseX;
                const nextY = basePositions[floor + 1]?.y ?? baseY;
                this.addTween(entity, 'positionX', disappearStartTime, disappearEndTime, baseX, nextX, ease);
                this.addTween(entity, 'positionY', disappearStartTime, disappearEndTime, baseY, nextY, ease);
                this.addTween(entity, 'scaleX', disappearStartTime, disappearEndTime, baseSX, 0, ease);
                this.addTween(entity, 'scaleY', disappearStartTime, disappearEndTime, baseSY, 0, ease);
                break;
            }
            case 'Shrink': {
                this.addTween(entity, 'scaleX', disappearStartTime, disappearEndTime, baseSX, 0, ease);
                this.addTween(entity, 'scaleY', disappearStartTime, disappearEndTime, baseSY, 0, ease);
                break;
            }
            case 'Shrink_Spin': {
                this.addTween(entity, 'scaleX', disappearStartTime, disappearEndTime, baseSX, 0, ease);
                this.addTween(entity, 'scaleY', disappearStartTime, disappearEndTime, baseSY, 0, ease);
                this.addTween(entity, 'rotation', disappearStartTime, disappearEndTime, baseRot, baseRot - Math.PI, ease);
                break;
            }
            case 'Fade': {
                this.addTween(entity, 'opacity', disappearStartTime, disappearEndTime, baseOp, 0, ease);
                break;
            }
        }
    }

    private seededRandom(seed: number): number {
        const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
        return x - Math.floor(x);
    }
}

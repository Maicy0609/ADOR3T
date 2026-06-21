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
    ) {
        this.tileStartTimes = tileStartTimes;
        this.tileBPM = tileBPM;
        this.totalTiles = totalTiles;
        this.build(actions, basePositions, baseRotations, baseScales, baseOpacities);
    }

    private build(
        actions: any[],
        basePositions: Vector2[],
        baseRotations: number[],
        baseScales: Vector2[],
        baseOpacities: number[],
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

        const initX = this.ensureTimeline(`tile:${tileIdx}`, 'positionX');
        const initY = this.ensureTimeline(`tile:${tileIdx}`, 'positionY');
        const initRot = this.ensureTimeline(`tile:${tileIdx}`, 'rotation');
        const initSX = this.ensureTimeline(`tile:${tileIdx}`, 'scaleX');
        const initSY = this.ensureTimeline(`tile:${tileIdx}`, 'scaleY');
        const initOp = this.ensureTimeline(`tile:${tileIdx}`, 'opacity');

        initX.push({ time: 0, value: baseX, ease: null });
        initY.push({ time: 0, value: baseY, ease: null });
        initRot.push({ time: 0, value: baseRot, ease: null });
        initSX.push({ time: 0, value: baseSX, ease: null });
        initSY.push({ time: 0, value: baseSY, ease: null });
        initOp.push({ time: 0, value: baseOp, ease: null });

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
}

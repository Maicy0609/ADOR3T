import * as THREE from 'three';
import { getEasingFunction } from './WasmEasing';
import { debugLog } from './DebugLog';
import { isEventActive, isFieldEnabled } from './EventUtils';
import { Level } from 'adofai';

interface AnimationProperty {
    property: string;
    startValue: number;
    endValue: number;
    startTime: number;
    duration: number;
    easingFunc: (t: number) => number;
}

interface TileAnimationState {
    animations: Map<string, AnimationProperty>;
}

interface PendingMoveTrackTarget {
    startTime: number;
    duration: number;
    easingFunc: (t: number) => number;
    targets: {
        positionX?: number;
        positionY?: number;
        rotationZ?: number;
        scaleX?: number;
        scaleY?: number;
        opacity?: number;
    };
}

export class MoveTrackManager {
    private levelData: any;
    private tileStartTimes: number[];
    private tileBPM: number[];

    private moveTrackEventsTimeline: { time: number; event: any }[] = [];
    private lastMoveTrackEventIndex: number = -1;

    private tileAnimationStates: Map<number, TileAnimationState> = new Map();

    private tileInitialStates: Map<number, {
        position: THREE.Vector3;
        rotation: THREE.Euler;
        scale: THREE.Vector3;
        opacity: number;
    }> = new Map();

    private tiles: Map<string, THREE.Mesh> | null = null;

    private basePositions: THREE.Vector2[] = [];
    private baseRotations: number[] = [];

    public tileTransformChanged?: (
        tileIndex: number,
        position: THREE.Vector3,
        rotation: THREE.Euler,
        scale: THREE.Vector3,
        opacity: number
    ) => void;

    private pendingMoveTrackTargets: Map<number, PendingMoveTrackTarget[]> = new Map();
    private currentTime: number = 0;

    private static playCounter: number = 0;
    private debugPlayId: number = 0;

    constructor(levelData: Level, tileStartTimes: number[], tileBPM: number[]) {
        this.levelData = levelData;
        this.tileStartTimes = tileStartTimes;
        this.tileBPM = tileBPM;
    }

    public setTilesReference(tiles: Map<string, THREE.Mesh>): void {
        this.tiles = tiles;
        tiles.forEach((tileMesh, tileId) => {
            const index = parseInt(tileId);
            if (!this.tileInitialStates.has(index)) {
                this.tileInitialStates.set(index, {
                    position: tileMesh.position.clone(),
                    rotation: tileMesh.rotation.clone() as THREE.Euler,
                    scale: tileMesh.scale.clone(),
                    opacity: tileMesh.userData.opacity ?? 1
                });
            }
        });
    }

    public setBasePositions(positions: THREE.Vector2[]): void {
        this.basePositions = positions;
    }

    public setBaseRotations(rotations: number[]): void {
        this.baseRotations = rotations;
    }

    public registerTileInitial(index: number, tileMesh: THREE.Mesh): void {
        const playLabel = `[MoveTrackManager][Play#${this.debugPlayId}]`;
        if (!this.tileInitialStates.has(index)) {
            debugLog(playLabel, `Registering initial state for tile ${index}: pos=(${tileMesh.position.x.toFixed(3)},${tileMesh.position.y.toFixed(3)}), rot=${tileMesh.rotation.z.toFixed(6)}`);
            this.tileInitialStates.set(index, {
                position: tileMesh.position.clone(),
                rotation: tileMesh.rotation.clone() as THREE.Euler,
                scale: tileMesh.scale.clone(),
                opacity: tileMesh.userData.opacity ?? 1
            });

            const pendingAnims = this.pendingMoveTrackTargets.get(index);
            if (pendingAnims && pendingAnims.length > 0) {
                debugLog(playLabel, `  tile[${index}] has ${pendingAnims.length} pending MoveTrack target(s)`);
                let state = this.tileAnimationStates.get(index);
                if (!state) {
                    state = { animations: new Map() };
                    this.tileAnimationStates.set(index, state);
                }
                for (const pending of pendingAnims) {
                    if (pending.duration <= 0) {
                        for (const [prop, value] of Object.entries(pending.targets)) {
                            if (value === undefined) continue;
                            this.animateProperty(tileMesh, prop, NaN, value,
                                0, pending.easingFunc, state, this.currentTime);
                        }
                    } else {
                        const elapsed = this.currentTime - pending.startTime;
                        const remainingDuration = Math.max(pending.duration - elapsed, 0.001);
                        for (const [prop, targetValue] of Object.entries(pending.targets)) {
                            if (targetValue === undefined) continue;
                            let currentValue: number;
                            switch (prop) {
                                case 'positionX': currentValue = tileMesh.position.x; break;
                                case 'positionY': currentValue = tileMesh.position.y; break;
                                case 'rotationZ': currentValue = tileMesh.rotation.z; break;
                                case 'scaleX': currentValue = tileMesh.scale.x; break;
                                case 'scaleY': currentValue = tileMesh.scale.y; break;
                                case 'opacity': currentValue = tileMesh.userData.opacity ?? 1; break;
                                default: continue;
                            }
                            this.animateProperty(tileMesh, prop, currentValue, targetValue,
                                remainingDuration, pending.easingFunc, state, this.currentTime);
                        }
                    }
                }
                this.pendingMoveTrackTargets.delete(index);
            }
        } else {
            debugLog(playLabel, `Skipping registerTileInitial for tile ${index} (already exists)`);
        }
    }

    public initializeMoveTrackEvents(tileMoveTrackEvents: Map<number, any[]>): void {
        this.moveTrackEventsTimeline = [];
        const entries: { time: number; event: any }[] = [];

        tileMoveTrackEvents.forEach((events, floor) => {
            const bpm = this.tileBPM[floor] || 100;
            const secPerBeat = 60 / bpm;
            const startTime = this.tileStartTimes[floor] || 0;

            // Sort by id for stable ordering within same floor
            const sorted = [...events].sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity));
            const zeroOffsetEvents = sorted.filter(e => (e.angleOffset || 0) === 0);

            sorted.forEach(event => {
                if (!isEventActive(event)) return;
                const eventWithFloor = { ...event, floor };
                const angleOffset = event.angleOffset || 0;
                let timeOffset = (angleOffset / 180) * secPerBeat;
                // Micro-offset for multiple zero-angleOffset events (matching camera)
                if (angleOffset === 0 && zeroOffsetEvents.length > 1) {
                    const order = zeroOffsetEvents.findIndex(e => e.id === event.id);
                    timeOffset += order * 0.0001;
                }
                const eventTime = startTime + timeOffset;
                const duration = (event.duration ?? 1) * secPerBeat;

                entries.push({
                    time: eventTime,
                    event: { ...eventWithFloor, duration, startTime: eventTime }
                });
            });
        });

        entries.sort((a, b) => {
            const dt = a.time - b.time;
            return Math.abs(dt) < 0.0001
                ? ((a.event.id ?? Infinity) - (b.event.id ?? Infinity))
                : (dt > 0 ? 1 : -1);
        });
        this.moveTrackEventsTimeline = entries;
        debugLog('[MoveTrackManager] Found MoveTrack events:', entries.length);
    }

    public update(elapsedTimeMs: number): void {
        const timeInSeconds = elapsedTimeMs / 1000;
        this.currentTime = timeInSeconds;
        this.processMoveTrackEvents(timeInSeconds);
        this.updateActiveAnimations(timeInSeconds);
        this.cleanupCompletedAnimations(timeInSeconds);
    }

    private updateActiveAnimations(currentTime: number): void {
        if (!this.tiles) return;

        for (const [tileIndex, state] of this.tileAnimationStates.entries()) {
            const mesh = this.tiles.get(tileIndex.toString());
            if (!mesh) continue;

            let anyDirty = false;

            // Absolute interpolation for per-property animations (overwrite model)
            for (const [propertyName, animation] of state.animations) {
                const elapsed = currentTime - animation.startTime;
                const progress = Math.min(elapsed / animation.duration, 1);
                const easedProgress = animation.easingFunc(progress);
                const value = animation.startValue + (animation.endValue - animation.startValue) * easedProgress;

                switch (propertyName) {
                    case 'positionX': mesh.position.x = value; break;
                    case 'positionY': mesh.position.y = value; break;
                    case 'scaleX': mesh.scale.x = value; break;
                    case 'scaleY': mesh.scale.y = value; break;
                    case 'rotationZ': mesh.rotation.z = value; break;
                    case 'opacity':
                        if (mesh.material) {
                            if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms.opacity) {
                                mesh.material.uniforms.opacity.value = value;
                            } else {
                                (mesh.material as any).opacity = value;
                            }
                            (mesh.material as any).transparent = value < 0.999;
                            mesh.userData.opacity = value;
                            mesh.visible = value > 0.001;
                            mesh.traverse((child) => {
                                if (child !== mesh && (child as any).material) {
                                    const childMat = (child as any).material;
                                    if (childMat.opacity !== undefined) {
                                        childMat.opacity = value;
                                    }
                                }
                            });
                        }
                        break;
                }

                if (progress >= 1) {
                    state.animations.delete(propertyName);
                }
                anyDirty = true;
            }

            if (anyDirty && this.tileTransformChanged) {
                this.tileTransformChanged(
                    tileIndex,
                    mesh.position,
                    mesh.rotation as THREE.Euler,
                    mesh.scale,
                    mesh.userData.opacity ?? 1
                );
            }
        }
    }

    private cleanupCompletedAnimations(currentTime: number): void {
        // no-op: handled in updateActiveAnimations
    }

    public getPlanetFollowOffset(tileIndex: number, currentTime: number): { x: number; y: number; rotation: number } {
        const mesh = this.tiles?.get(tileIndex.toString());
        if (!mesh) return { x: 0, y: 0, rotation: 0 };
        const initialState = this.tileInitialStates.get(tileIndex);
        if (!initialState) return { x: 0, y: 0, rotation: 0 };
        return {
            x: mesh.position.x - initialState.position.x,
            y: mesh.position.y - initialState.position.y,
            rotation: mesh.rotation.z - initialState.rotation.z,
        };
    }

    private processMoveTrackEvents(timeInSeconds: number): void {
        const playLabel = `[MoveTrackManager][Play#${this.debugPlayId}]`;
        if (this.lastMoveTrackEventIndex >= 0 && this.lastMoveTrackEventIndex < this.moveTrackEventsTimeline.length) {
            const lastEvent = this.moveTrackEventsTimeline[this.lastMoveTrackEventIndex];
            if (timeInSeconds < lastEvent.time) {
                debugLog(playLabel, `REWIND: resetting lastMoveTrackEventIndex from ${this.lastMoveTrackEventIndex} to -1`);
                this.lastMoveTrackEventIndex = -1;
            }
        }

        while (
            this.lastMoveTrackEventIndex + 1 < this.moveTrackEventsTimeline.length &&
            this.moveTrackEventsTimeline[this.lastMoveTrackEventIndex + 1].time <= timeInSeconds
        ) {
            this.lastMoveTrackEventIndex++;
            const entry = this.moveTrackEventsTimeline[this.lastMoveTrackEventIndex];
            if (entry) {
                this.processMoveTrackEvent(entry.event, timeInSeconds);
            }
        }
    }

    private processMoveTrackEvent(event: any, currentTime: number): void {
        if (!this.tiles) return;

        const playLabel = `[MoveTrackManager][Play#${this.debugPlayId}]`;
        const startTile = this.parseTileReference(event.startTile, event.floor);
        const endTile = this.parseTileReference(event.endTile, event.floor);
        const start = Math.min(startTile, endTile);
        const end = Math.max(startTile, endTile);
        const gapLength = event.gapLength || 0;

        const duration = event.duration ?? 1;
        const ease = event.ease || 'Linear.easeNone';
        const positionUsed = event.positionOffset !== undefined && isFieldEnabled(event, 'positionOffset');
        const rotationUsed = event.rotationOffset !== undefined && isFieldEnabled(event, 'rotationOffset');
        const scaleUsed = event.scale !== undefined && isFieldEnabled(event, 'scale');
        const opacityUsed = event.opacity != null && isFieldEnabled(event, 'opacity');
        
        // Handle position offset - may contain null values for individual axes
        const positionOffsetX = positionUsed && event.positionOffset[0] != null ? event.positionOffset[0] : null;
        const positionOffsetY = positionUsed && event.positionOffset[1] != null ? event.positionOffset[1] : null;
        
        const rotationOffset = rotationUsed ? (event.rotationOffset || 0) : 0;
        
        // Handle scale - may contain null values for individual axes
        let scaleX: number | null = null;
        let scaleY: number | null = null;
        if (scaleUsed && event.scale) {
            if (Array.isArray(event.scale)) {
                scaleX = event.scale[0] != null ? event.scale[0] : null;
                scaleY = event.scale[1] != null ? event.scale[1] : null;
            } else {
                scaleX = scaleY = event.scale;
            }
        }
        
        const opacity = opacityUsed ? event.opacity / 100 : 1;

        const easingFunc = this.getEasingFunction(ease);

        for (let i = start; i <= end; i += 1 + gapLength) {
            const tileId = i.toString();
            const tileMesh = this.tiles.get(tileId);

            const initialState = this.tileInitialStates.get(i);
            const tileBasePosX = (i < this.basePositions.length) ? this.basePositions[i].x : (initialState?.position.x ?? 0);
            const tileBasePosY = (i < this.basePositions.length) ? this.basePositions[i].y : (initialState?.position.y ?? 0);
            const tileBaseRot = (i < this.baseRotations.length) ? this.baseRotations[i] : (initialState?.rotation.z ?? 0);
            const tileBaseScaleX = initialState?.scale.x ?? 1;
            const tileBaseScaleY = initialState?.scale.y ?? 1;
            const tileBaseOpacity = initialState?.opacity ?? 1;

            if (!tileMesh) {
                const targets: PendingMoveTrackTarget['targets'] = {};
                if (positionOffsetX != null) {
                    targets.positionX = tileBasePosX + positionOffsetX;
                }
                if (positionOffsetY != null) {
                    targets.positionY = tileBasePosY + positionOffsetY;
                }
                if (rotationUsed) {
                    targets.rotationZ = tileBaseRot + rotationOffset * Math.PI / 180;
                }
                if (scaleX != null) {
                    targets.scaleX = scaleX / 100;
                }
                if (scaleY != null) {
                    targets.scaleY = scaleY / 100;
                }
                if (opacityUsed) {
                    targets.opacity = opacity;
                }
                if (Object.keys(targets).length > 0) {
                    const pendingEntry: PendingMoveTrackTarget = {
                        startTime: currentTime, duration, easingFunc, targets
                    };
                    if (!this.pendingMoveTrackTargets.has(i)) {
                        this.pendingMoveTrackTargets.set(i, []);
                    }
                    this.pendingMoveTrackTargets.get(i)!.push(pendingEntry);
                }
                continue;
            }

            let state = this.tileAnimationStates.get(i);
            if (!state) {
                state = { animations: new Map() };
                this.tileAnimationStates.set(i, state);
            }

            // Position: absolute interpolation (overwrite model)
            if (positionOffsetX != null) {
                const targetX = tileBasePosX + positionOffsetX;
                if (!isNaN(targetX)) {
                    this.animateProperty(tileMesh, 'positionX', tileMesh.position.x, targetX,
                        duration, easingFunc, state, currentTime);
                }
            }
            if (positionOffsetY != null) {
                const targetY = tileBasePosY + positionOffsetY;
                if (!isNaN(targetY)) {
                    this.animateProperty(tileMesh, 'positionY', tileMesh.position.y, targetY,
                        duration, easingFunc, state, currentTime);
                }
            }

            // Rotation: absolute interpolation (overwrite model, matching original game)
            if (rotationUsed) {
                const targetRot = tileBaseRot + rotationOffset * Math.PI / 180;
                if (!isNaN(targetRot)) {
                    this.animateProperty(tileMesh, 'rotationZ', tileMesh.rotation.z, targetRot,
                        duration, easingFunc, state, currentTime);
                }
            }

            // Scale: absolute interpolation (overwrite model)
            if (scaleX != null) {
                const targetScaleX = scaleX / 100;
                if (!isNaN(targetScaleX)) {
                    this.animateProperty(tileMesh, 'scaleX', tileMesh.scale.x, targetScaleX,
                        duration, easingFunc, state, currentTime);
                }
            }
            if (scaleY != null) {
                const targetScaleY = scaleY / 100;
                if (!isNaN(targetScaleY)) {
                    this.animateProperty(tileMesh, 'scaleY', tileMesh.scale.y, targetScaleY,
                        duration, easingFunc, state, currentTime);
                }
            }

            // Opacity: absolute interpolation (overwrite model)
            if (opacityUsed) {
                const currentOpacity = tileMesh.userData.opacity ?? 1;
                this.animateProperty(tileMesh, 'opacity', currentOpacity, opacity,
                    duration, easingFunc, state, currentTime);
            }
        }
    }

    private animateProperty(
        mesh: THREE.Mesh,
        property: string,
        startValue: number,
        endValue: number,
        duration: number,
        easingFunc: (t: number) => number,
        state: TileAnimationState,
        startTime: number
    ): void {
        if (duration <= 0) {
            switch (property) {
                case 'positionX': mesh.position.x = endValue; break;
                case 'positionY': mesh.position.y = endValue; break;
                case 'rotationZ': mesh.rotation.z = endValue; break;
                case 'scaleX': mesh.scale.x = endValue; break;
                case 'scaleY': mesh.scale.y = endValue; break;
                case 'opacity':
                    if (mesh.material) {
                        if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms.opacity) {
                            mesh.material.uniforms.opacity.value = endValue;
                        } else {
                            (mesh.material as any).opacity = endValue;
                        }
                        (mesh.material as any).transparent = endValue < 0.999;
                        mesh.userData.opacity = endValue;
                        mesh.visible = endValue > 0.001;
                        mesh.traverse((child) => {
                            if (child !== mesh && (child as any).material) {
                                const childMat = (child as any).material;
                                if (childMat.opacity !== undefined) {
                                    childMat.opacity = endValue;
                                }
                            }
                        });
                    }
                    break;
            }
            state.animations.delete(property);
            return;
        }

        state.animations.set(property, {
            property, startValue, endValue, startTime, duration, easingFunc
        });
    }

    private parseTileReference(ref: any, currentFloor: number): number {
        if (Array.isArray(ref) && ref.length >= 2) {
            const offset = Number(ref[0]) || 0;
            const relativeTo = ref[1];
            if (relativeTo === 'ThisTile' || relativeTo === 0) {
                return currentFloor + offset;
            } else if (relativeTo === 'Start' || relativeTo === 1) {
                return offset;
            } else if (relativeTo === 'End' || relativeTo === 2) {
                return (this.levelData.tiles.length - 1) + offset;
            }
        }
        return Number(ref) || currentFloor;
    }

    private normalizeAngle(angle: number): number {
        let normalized = angle % (2 * Math.PI);
        if (normalized > Math.PI) {
            normalized -= 2 * Math.PI;
        } else if (normalized < -Math.PI) {
            normalized += 2 * Math.PI;
        }
        return normalized;
    }

    private approximatelyEqual(a: number, b: number, epsilon: number = 1e-5): boolean {
        return Math.abs(a - b) < epsilon;
    }

    private getEasingFunction(easeName: string): (t: number) => number {
        return getEasingFunction(easeName);
    }

    public fastForwardTo(targetTime: number): void {
        this.currentTime = targetTime;
        while (
            this.lastMoveTrackEventIndex + 1 < this.moveTrackEventsTimeline.length &&
            this.moveTrackEventsTimeline[this.lastMoveTrackEventIndex + 1].time <= targetTime
        ) {
            this.lastMoveTrackEventIndex++;
            const entry = this.moveTrackEventsTimeline[this.lastMoveTrackEventIndex];
            if (entry) {
                this.applyMoveTrackEventInstant(entry.event, targetTime);
            }
        }
        this.tileAnimationStates.clear();
    }

    private applyMoveTrackEventInstant(event: any, currentTime: number): void {
        if (!this.tiles) return;

        const startTile = this.parseTileReference(event.startTile, event.floor);
        const endTile = this.parseTileReference(event.endTile, event.floor);
        const start = Math.min(startTile, endTile);
        const end = Math.max(startTile, endTile);
        const gapLength = event.gapLength || 0;

        const positionUsed = event.positionOffset !== undefined && isFieldEnabled(event, 'positionOffset');
        const rotationUsed = event.rotationOffset !== undefined && isFieldEnabled(event, 'rotationOffset');
        const scaleUsed = event.scale !== undefined && isFieldEnabled(event, 'scale');
        const opacityUsed = event.opacity != null && isFieldEnabled(event, 'opacity');
        
        // Handle position offset - may contain null values for individual axes
        const positionOffsetX = positionUsed && event.positionOffset[0] != null ? event.positionOffset[0] : null;
        const positionOffsetY = positionUsed && event.positionOffset[1] != null ? event.positionOffset[1] : null;
        
        const rotationOffset = rotationUsed ? (event.rotationOffset || 0) : 0;
        
        // Handle scale - may contain null values for individual axes
        let scaleX: number | null = null;
        let scaleY: number | null = null;
        if (scaleUsed && event.scale) {
            if (Array.isArray(event.scale)) {
                scaleX = event.scale[0] != null ? event.scale[0] : null;
                scaleY = event.scale[1] != null ? event.scale[1] : null;
            } else {
                scaleX = scaleY = event.scale;
            }
        }
        
        const opacity = opacityUsed ? event.opacity / 100 : 1;

        for (let i = start; i <= end; i += 1 + gapLength) {
            const tileId = i.toString();
            const tileMesh = this.tiles.get(tileId);

            const initialState = this.tileInitialStates.get(i);
            const tileBasePosX = (i < this.basePositions.length) ? this.basePositions[i].x : (initialState?.position.x ?? 0);
            const tileBasePosY = (i < this.basePositions.length) ? this.basePositions[i].y : (initialState?.position.y ?? 0);
            const tileBaseRot = (i < this.baseRotations.length) ? this.baseRotations[i] : (initialState?.rotation.z ?? 0);

            if (!tileMesh) {
                const targets: PendingMoveTrackTarget['targets'] = {};
                if (positionOffsetX != null) {
                    targets.positionX = tileBasePosX + positionOffsetX;
                }
                if (positionOffsetY != null) {
                    targets.positionY = tileBasePosY + positionOffsetY;
                }
                if (rotationUsed) {
                    targets.rotationZ = tileBaseRot + rotationOffset * Math.PI / 180;
                }
                if (scaleX != null) {
                    targets.scaleX = scaleX / 100;
                }
                if (scaleY != null) {
                    targets.scaleY = scaleY / 100;
                }
                if (opacityUsed) {
                    targets.opacity = opacity;
                }
                if (Object.keys(targets).length > 0) {
                    const pendingEntry: PendingMoveTrackTarget = {
                        startTime: currentTime, duration: 0,
                        easingFunc: (t: number) => t, targets
                    };
                    if (!this.pendingMoveTrackTargets.has(i)) {
                        this.pendingMoveTrackTargets.set(i, []);
                    }
                    this.pendingMoveTrackTargets.get(i)!.push(pendingEntry);
                }
                continue;
            }

            if (positionOffsetX != null) {
                const tx = tileBasePosX + positionOffsetX;
                if (!isNaN(tx)) tileMesh.position.x = tx;
            }
            if (positionOffsetY != null) {
                const ty = tileBasePosY + positionOffsetY;
                if (!isNaN(ty)) tileMesh.position.y = ty;
            }
            if (scaleX != null) {
                tileMesh.scale.x = scaleX / 100;
            }
            if (scaleY != null) {
                tileMesh.scale.y = scaleY / 100;
            }
            if (rotationUsed) {
                tileMesh.rotation.z = tileBaseRot + rotationOffset * Math.PI / 180;
            }
            if (scaleUsed) {
                if (scaleX != null && !isNaN(scaleX / 100)) tileMesh.scale.x = scaleX / 100;
                if (scaleY != null && !isNaN(scaleY / 100)) tileMesh.scale.y = scaleY / 100;
            }
            if (opacityUsed) {
                tileMesh.userData.opacity = opacity;
                if (tileMesh.material) {
                    (tileMesh.material as any).opacity = opacity;
                    (tileMesh.material as any).transparent = opacity < 0.999;
                }
                tileMesh.visible = opacity > 0.001;
                tileMesh.traverse((child) => {
                    if (child !== tileMesh && (child as any).material) {
                        (child as any).material.opacity = opacity;
                    }
                });
            }

            if (this.tileTransformChanged) {
                this.tileTransformChanged(
                    i, tileMesh.position, tileMesh.rotation as THREE.Euler,
                    tileMesh.scale, tileMesh.userData.opacity ?? 1
                );
            }
        }
    }

    public getAnimatedTileIndices(): Set<number> {
        return new Set(this.tileAnimationStates.keys());
    }

    public reset(): void {
        this.debugPlayId = ++MoveTrackManager.playCounter;
        const playLabel = `[MoveTrackManager][Play#${this.debugPlayId}]`;

        this.tileAnimationStates.clear();
        this.pendingMoveTrackTargets.clear();
        this.lastMoveTrackEventIndex = -1;

        if (this.tiles) {
            this.tileInitialStates.forEach((initial, index) => {
                const mesh = this.tiles!.get(index.toString());
                if (mesh) {
                    mesh.position.copy(initial.position);
                    mesh.rotation.copy(initial.rotation);
                    mesh.scale.copy(initial.scale);
                    mesh.userData.opacity = initial.opacity;
                    mesh.visible = initial.opacity > 0.001;

                    if (mesh.material) {
                        (mesh.material as any).opacity = initial.opacity;
                        (mesh.material as any).transparent = initial.opacity < 0.999;
                    }

                    mesh.traverse((child) => {
                        if (child !== mesh && (child as any).material) {
                            const childMat = (child as any).material;
                            if (childMat.opacity !== undefined) {
                                childMat.opacity = initial.opacity;
                            }
                        }
                    });

                    if (this.tileTransformChanged) {
                        this.tileTransformChanged(
                            index, mesh.position, mesh.rotation as THREE.Euler,
                            mesh.scale, mesh.userData.opacity ?? 1
                        );
                    }
                }
            });
        }

        debugLog(playLabel, 'Reset complete');
    }

    public dispose(): void {
        this.reset();
        this.tileInitialStates.clear();
        this.moveTrackEventsTimeline = [];
    }
}

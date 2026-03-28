import * as THREE from 'three';

/**
 * PositionTrack event interface
 */
export interface PositionTrackEvent {
    positionOffset?: [number, number];
    relativeTo?: [number, string];
    rotation?: number;
    scale?: number;
    opacity?: number;
    justThisTile?: boolean;
    editorOnly?: boolean;
    stickToFloors?: boolean | 'Enabled' | 'Disabled';
}

/**
 * Tile transform result
 */
export interface TileTransform {
    position: THREE.Vector3;
    rotation: number;
    scale: THREE.Vector3;
    opacity: number;
    stickToFloors: boolean;
}

/**
 * Manages PositionTrack events - using ADOFAI-Src's cumulative logic
 * Implements our own tile position calculation based on ADOFAI-JS structure
 */
export class PositionTrackManager {
    private levelData: any;
    private positionTrackEvents: Map<number, PositionTrackEvent[]>;
    private tileTransforms: Map<number, TileTransform>;

    constructor(levelData: any) {
        this.levelData = levelData;
        this.positionTrackEvents = new Map();
        this.tileTransforms = new Map();

        this.parsePositionTrackEvents();
    }

    /**
     * Parse stickToFloors value
     */
    private parseStickToFloors(value: boolean | 'Enabled' | 'Disabled' | undefined): boolean {
        if (value === undefined || value === null) {
            return this.levelData.settings?.stickToFloors !== false;
        }
        
        if (typeof value === 'boolean') {
            return value;
        }
        
        if (typeof value === 'string') {
            return value === 'Enabled';
        }
        
        return true;
    }

    /**
     * Parse position track events from level data
     */
    private parsePositionTrackEvents(): void {
        if (!this.levelData.actions) return;

        for (const action of this.levelData.actions) {
            if (action.eventType === 'PositionTrack') {
                const floor = action.floor;
                if (!this.positionTrackEvents.has(floor)) {
                    this.positionTrackEvents.set(floor, []);
                }
                this.positionTrackEvents.get(floor)!.push({
                    positionOffset: action.positionOffset || [0, 0],
                    relativeTo: action.relativeTo || [0, 'ThisTile'],
                    rotation: action.rotation || 0,
                    scale: action.scale || 100,
                    opacity: action.opacity || 100,
                    justThisTile: action.justThisTile || false,
                    editorOnly: action.editorOnly || false,
                    stickToFloors: this.parseStickToFloors(action.stickToFloors)
                });
            }
        }
    }

    /**
     * Calculate all tile positions and transforms
     * Uses ADOFAI-JS structure for position calculation
     * Uses ADOFAI-Src cumulative logic for PositionTrack
     */
    public calculateAllTileTransforms(isEditorMode: boolean = false): Map<number, TileTransform> {
        const transforms = new Map<number, TileTransform>();
        const tiles = this.levelData.tiles;
        const angleData = this.levelData.angleData || [];
        
        // Start from (0, 0)
        let currentPos = new THREE.Vector2(0, 0);
        
        // Cumulative values (vector in ADOFAI-Src)
        let cumulativeOffset = new THREE.Vector2(0, 0);
        let cumulativeRotation = 0;
        let cumulativeScale = 1;
        let cumulativeOpacity = 1;
        let cumulativeStickToFloors = this.levelData.settings?.stickToFloors !== false;

        // Pre-calculate all angles
        const floats = new Array(tiles.length);
        for (let i = 0; i < tiles.length; i++) {
            floats[i] = angleData[i] === 999 ? (angleData[i - 1] || 0) + 180 : angleData[i];
        }

        for (let i = 0; i <= tiles.length; i++) {
            const isLastTile = i === tiles.length;
            const angle1 = isLastTile ? (floats[i - 1] || 0) : floats[i];
            const angle2 = i === 0 ? 0 : (floats[i - 1] || 0);

            if (!isLastTile) {
                // Current tile transform (vector2 in ADOFAI-Src)
                let tileOffset = cumulativeOffset.clone();
                let tileRotation = cumulativeRotation;
                let tileScale = cumulativeScale;
                let tileOpacity = cumulativeOpacity;
                let tileStickToFloors = cumulativeStickToFloors;

                // Process PositionTrack events for this tile
                const events = this.positionTrackEvents.get(i);
                if (events && events.length > 0) {
                    for (const event of events) {
                        if (event.editorOnly && !isEditorMode) {
                            continue;
                        }

                        // Apply position offset
                        if (event.positionOffset) {
                            tileOffset.x += event.positionOffset[0];
                            tileOffset.y += event.positionOffset[1];
                        }

                        // Apply rotation
                        if (event.rotation !== undefined) {
                            tileRotation = event.rotation;
                        }

                        // Apply scale
                        if (event.scale !== undefined) {
                            tileScale = event.scale / 100;
                        }

                        // Apply opacity
                        if (event.opacity !== undefined) {
                            tileOpacity = event.opacity / 100;
                        }

                        // Apply stickToFloors
                        if (event.stickToFloors !== undefined) {
                            tileStickToFloors = this.parseStickToFloors(event.stickToFloors);
                        }

                        // Update cumulative values for next tiles (if not justThisTile)
                        if (!event.justThisTile) {
                            cumulativeOffset = tileOffset.clone();
                            cumulativeRotation = tileRotation;
                            cumulativeScale = tileScale;
                            cumulativeOpacity = tileOpacity;
                            cumulativeStickToFloors = tileStickToFloors;
                        }
                    }
                }

                // Calculate final position
                const finalX = currentPos.x + tileOffset.x;
                const finalY = currentPos.y + tileOffset.y;
                const zLevel = 12 - i;

                transforms.set(i, {
                    position: new THREE.Vector3(finalX, finalY, zLevel * 0.001),
                    rotation: tileRotation,
                    scale: new THREE.Vector3(tileScale, tileScale, tileScale),
                    opacity: tileOpacity,
                    stickToFloors: tileStickToFloors
                });
            }

            // Update position for next tile (based on angle)
            const rad = angle1 * Math.PI / 180;
            currentPos.x += Math.cos(rad);
            currentPos.y += Math.sin(rad);
        }

        this.tileTransforms = transforms;
        return transforms;
    }

    /**
     * Get transform for a specific tile
     */
    public getTileTransform(tileIndex: number): TileTransform | undefined {
        return this.tileTransforms.get(tileIndex);
    }

    /**
     * Get all tile transforms
     */
    public getAllTileTransforms(): Map<number, TileTransform> {
        return this.tileTransforms;
    }

    /**
     * Dispose
     */
    public dispose(): void {
        this.positionTrackEvents.clear();
        this.tileTransforms.clear();
    }
}
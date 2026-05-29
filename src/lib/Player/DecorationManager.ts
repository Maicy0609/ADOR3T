import * as THREE from 'three';
import { EasingFunctions } from './Easing';
import createTrackMesh, { MeshData } from '../Geo/mesh_reserve';
import { isEventActive } from './EventUtils';
import { getIconTexture, getIconTextureForCustomFloor, createIconSprite } from './IconLoader';

/**
 * Parse ADOFAI hex color which may be #RRGGBBAA (8-digit with alpha).
 * Returns [rgbString, alpha01] where rgbString is #RRGGBB and alpha01 is 0..1.
 * THREE.Color only accepts #RRGGBB, so alpha must be split out.
 */
function parseDecoColor(hex: string | undefined, fallback: string = 'ffffff'): [string, number] {
    const raw = (hex || fallback).replace(/^#/, '');
    if (raw.length >= 8) {
        const alpha = parseInt(raw.slice(6, 8), 16) / 255;
        return ['#' + raw.slice(0, 6), alpha];
    }
    return ['#' + raw.slice(0, 6), 1];
}

export enum DecorationType {
    Image = 'Image',
    Text = 'Text',
    Object = 'Object',
    Particle = 'Particle',
    Prefab = 'Prefab'
}

export enum DecPlacementType {
    Tile = 'Tile',
    Camera = 'Camera',
    CameraAspect = 'CameraAspect',
    LastPosition = 'LastPosition'
}

export interface DecorationConfig {
    id?: string;
    tag: string;
    decorationType: DecorationType;
    decorationImage: string;
    decText?: string;
    position: [number, number];
    positionOffset: [number, number];
    relativeTo: DecPlacementType;
    rotation: number;
    rotationOffset: number;
    scale: [number, number];
    parallax: [number, number];
    parallaxOffset: [number, number];
    pivotOffset: [number, number];
    depth: number;
    color: string;
    opacity: number;
    lockScale: boolean;
    lockRotation: boolean;
    visible: boolean;
    floor?: number;
    animating: boolean;
    animationStart: number;
    animationDuration: number;
    animationStartValues: Partial<DecorationConfig>;
    animationTargetValues: Partial<DecorationConfig>;
    animationEase: string;
    objectType?: string;
    planetColorType?: string;
    planetColor?: string;
    planetTailColor?: string;
    trackColor?: string;
    trackColor2?: string;
    trackOpacity?: number;
    trackStyle?: string;
    trackIcon?: string;
}

const defaultDecorationConfig: DecorationConfig = {
    tag: '',
    decorationType: DecorationType.Image,
    decorationImage: '',
    decText: '',
    position: [0, 0],
    positionOffset: [0, 0],
    relativeTo: DecPlacementType.Tile,
    rotation: 0,
    rotationOffset: 0,
    scale: [100, 100],
    parallax: [100, 100],
    parallaxOffset: [0, 0],
    pivotOffset: [0, 0],
    depth: 0,
    color: 'ffffff',
    opacity: 100,
    lockScale: false,
    lockRotation: false,
    visible: true,
    animating: false,
    animationStart: 0,
    animationDuration: 0,
    animationStartValues: {},
    animationTargetValues: {},
    animationEase: 'Linear'
};

class DecorationInstance {
    public config: DecorationConfig;
    public container: THREE.Group;
    public mesh: THREE.Mesh | null = null;
    public sprite: THREE.Sprite | null = null;
    public objectGroup: THREE.Group | null = null;
    public iconSprite: THREE.Sprite | null = null;
    public startPos: THREE.Vector2 = new THREE.Vector2();
    public pivotPos: THREE.Vector2 = new THREE.Vector2();
    public currentPosition: THREE.Vector2 = new THREE.Vector2();
    public currentScale: THREE.Vector2 = new THREE.Vector2(1, 1);
    public currentRotation: number = 0;
    public currentColor: THREE.Color = new THREE.Color(0xffffff);
    public currentOpacity: number = 1;
    public currentParallax: THREE.Vector2 = new THREE.Vector2(1, 1);
    public currentParallaxOffset: THREE.Vector2 = new THREE.Vector2();
    private animStartColor: THREE.Color = new THREE.Color();
    private animTargetColor: THREE.Color = new THREE.Color();
    private originalVisible: boolean = true;

    constructor(config: Partial<DecorationConfig>) {
        this.config = { ...defaultDecorationConfig, ...config };
        this.container = new THREE.Group();
        this.container.name = `decoration_${this.config.tag || 'untagged'}`;
        this.currentScale.set(this.config.scale[0] / 100, this.config.scale[1] / 100);
        this.currentRotation = this.config.rotation + this.config.rotationOffset;
        // Parse color with alpha: #RRGGBBAA → color=#RRGGBB, alpha extracted
        const [colorHex, colorAlpha] = parseDecoColor(this.config.color);
        this.currentColor.set(colorHex);
        this.currentOpacity = (this.config.opacity / 100) * colorAlpha;
        this.currentPosition.set(this.config.position[0], this.config.position[1]);
        this.currentParallax.set(this.config.parallax[0] / 100, this.config.parallax[1] / 100);
        this.currentParallaxOffset.set(this.config.parallaxOffset[0], this.config.parallaxOffset[1]);
        this.originalVisible = this.config.visible;
    }

    private formatHex(hex: string): string {
        // Strip alpha channel if present (#RRGGBBAA → #RRGGBB)
        const raw = hex.replace(/^#/, '');
        return '#' + raw.slice(0, 6);
    }

    public setupVisual(texture: THREE.Texture | null): void {
        this.clearVisual();
        if (this.config.decorationType === DecorationType.Object) return;
        if (!texture) {
            const g = new THREE.PlaneGeometry(1, 1);
            const m = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
            this.mesh = new THREE.Mesh(g, m);
            this.container.add(this.mesh);
        } else {
            const mat = new THREE.SpriteMaterial({
                map: texture, color: 0xffffff, transparent: true, opacity: this.currentOpacity
            });
            this.sprite = new THREE.Sprite(mat);
            let ar = 1;
            if (texture.image?.width && texture.image?.height) ar = texture.image.width / texture.image.height;
            ar >= 1
                ? this.sprite.scale.set(ar, 1, 1)
                : this.sprite.scale.set(1, 1 / ar, 1);
            this.sprite.center.set(0.5, 0.5);
            this.container.add(this.sprite);
        }
        this.updateTransform();
    }

    private clearVisual(): void {
        if (this.mesh) { this.container.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = null; }
        if (this.sprite) { this.container.remove(this.sprite); (this.sprite.material as THREE.Material).dispose(); this.sprite = null; }
        if (this.objectGroup) { this.container.remove(this.objectGroup); this.objectGroup = null; }
        if (this.iconSprite) { (this.iconSprite.material as THREE.Material).dispose(); this.iconSprite = null; }
    }

    public updateTransform(): void {
        this.container.rotation.z = this.currentRotation * Math.PI / 180;
        const d = this.config.depth;
        let z: number, ro: number;
        if (d < 0) { z = 0.2 + d * 0.1; ro = 200 + d; }
        else if (d === 0) { z = 0.15; ro = 50; }
        else { z = -0.5 - d * 0.5; ro = -d * 10; }
        this.container.position.set(this.currentPosition.x, this.currentPosition.y, z);
        if (this.mesh) { this.mesh.renderOrder = ro; (this.mesh.material as THREE.MeshBasicMaterial).color.copy(this.currentColor); (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.currentOpacity; }
        if (this.sprite) { this.sprite.renderOrder = ro; (this.sprite.material as THREE.SpriteMaterial).opacity = this.currentOpacity; }
        if (this.iconSprite) { this.iconSprite.renderOrder = ro + 1; (this.iconSprite.material as THREE.SpriteMaterial).opacity = this.currentOpacity; }
    }

    public updatePosition(camPos: THREE.Vector3, camRot: number, camZoom: number): void {
        let sm = 1;
        if (this.config.lockScale && camZoom > 0) sm = 100 / camZoom;
        const ct = this.config.relativeTo;
        if (ct === DecPlacementType.Camera || ct === DecPlacementType.CameraAspect) {
            this.container.position.x = camPos.x + this.currentPosition.x;
            this.container.position.y = camPos.y + this.currentPosition.y;
            this.container.rotation.z = this.config.lockRotation
                ? camRot + this.currentRotation * Math.PI / 180
                : this.currentRotation * Math.PI / 180;
        } else {
            const px = (camPos.x - this.pivotPos.x) * this.currentParallax.x;
            const py = (camPos.y - this.pivotPos.y) * this.currentParallax.y;
            this.container.position.x = this.currentPosition.x + px + this.currentParallaxOffset.x;
            this.container.position.y = this.currentPosition.y + py + this.currentParallaxOffset.y;
            this.container.rotation.z = this.config.lockRotation
                ? camRot + this.currentRotation * Math.PI / 180
                : this.currentRotation * Math.PI / 180;
        }
        this.container.scale.set(this.currentScale.x * sm, this.currentScale.y * sm, 1);
    }

    public updateAnimation(now: number): void {
        if (!this.config.animating) return;
        const el = now - this.config.animationStart;
        const dur = this.config.animationDuration;
        if (dur <= 0) { this.config.animating = false; this.applyAnimationTarget(); return; }
        if (el >= dur) { this.config.animating = false; this.applyAnimationTarget(); return; }
        const p = Math.max(0, Math.min(1, el / dur));
        const ease = (EasingFunctions as any)[this.config.animationEase] || EasingFunctions.Linear;
        const ep = ease(p);
        const s = this.config.animationStartValues;
        const t = this.config.animationTargetValues;
        if (s.positionOffset && t.positionOffset) {
            this.currentPosition.x = s.positionOffset[0] + (t.positionOffset[0] - s.positionOffset[0]) * ep;
            this.currentPosition.y = s.positionOffset[1] + (t.positionOffset[1] - s.positionOffset[1]) * ep;
            this.pivotPos.copy(this.currentPosition);
        }
        if (s.rotationOffset !== undefined && t.rotationOffset !== undefined) {
            this.currentRotation = this.config.rotation + s.rotationOffset + (t.rotationOffset - s.rotationOffset) * ep;
        }
        if (s.scale && t.scale) {
            this.currentScale.x = (s.scale[0] + (t.scale[0] - s.scale[0]) * ep) / 100;
            this.currentScale.y = (s.scale[1] + (t.scale[1] - s.scale[1]) * ep) / 100;
        }
        if (s.opacity !== undefined && t.opacity !== undefined) {
            this.currentOpacity = (s.opacity + (t.opacity - s.opacity) * ep) / 100;
        }
        if (s.color && t.color) {
            this.animStartColor.set(this.formatHex(s.color));
            this.animTargetColor.set(this.formatHex(t.color));
            this.currentColor.lerpColors(this.animStartColor, this.animTargetColor, ep);
        }
        if (s.parallax && t.parallax) {
            this.currentParallax.x = (s.parallax[0] + (t.parallax[0] - s.parallax[0]) * ep) / 100;
            this.currentParallax.y = (s.parallax[1] + (t.parallax[1] - s.parallax[1]) * ep) / 100;
        }
        if (s.parallaxOffset && t.parallaxOffset) {
            this.currentParallaxOffset.x = s.parallaxOffset[0] + (t.parallaxOffset[0] - s.parallaxOffset[0]) * ep;
            this.currentParallaxOffset.y = s.parallaxOffset[1] + (t.parallaxOffset[1] - s.parallaxOffset[1]) * ep;
        }
        this.updateTransform();
    }

    private applyAnimationTarget(): void {
        const t = this.config.animationTargetValues;
        if (t.positionOffset) { this.currentPosition.set(t.positionOffset[0], t.positionOffset[1]); this.pivotPos.copy(this.currentPosition); }
        if (t.rotationOffset !== undefined) this.currentRotation = this.config.rotation + t.rotationOffset;
        if (t.scale) { this.currentScale.x = t.scale[0] / 100; this.currentScale.y = t.scale[1] / 100; }
        if (t.opacity !== undefined) this.currentOpacity = t.opacity / 100;
        if (t.color) {
            const [hex, alpha] = parseDecoColor(t.color);
            this.currentColor.set(hex);
            this.currentOpacity *= alpha;
        }
        if (t.parallax) { this.currentParallax.x = t.parallax[0] / 100; this.currentParallax.y = t.parallax[1] / 100; }
        if (t.parallaxOffset) { this.currentParallaxOffset.set(t.parallaxOffset[0], t.parallaxOffset[1]); }
        if (t.depth !== undefined) this.config.depth = t.depth;
        if (t.visible !== undefined) { this.config.visible = t.visible; this.container.visible = t.visible; }
        this.updateTransform();
    }

    public startAnimation(targetValues: Partial<DecorationConfig>, duration: number, ease: string, startTime: number, movementType: DecPlacementType): void {
        if (this.config.animating) { this.applyAnimationTarget(); this.config.animating = false; }
        const animStartPos = movementType === DecPlacementType.LastPosition
            ? new THREE.Vector2(this.currentPosition.x, this.currentPosition.y)
            : new THREE.Vector2(this.startPos.x, this.startPos.y);
        // Start values snap from CURRENT state (not config), so consecutive tweens don't jump
        this.config.animationStartValues = {
            positionOffset: [this.currentPosition.x, this.currentPosition.y],
            rotationOffset: this.currentRotation - this.config.rotation,
            scale: [this.currentScale.x * 100, this.currentScale.y * 100],
            color: '#' + this.currentColor.getHexString(),
            opacity: this.currentOpacity * 100,
            parallax: [this.currentParallax.x * 100, this.currentParallax.y * 100],
            parallaxOffset: [this.currentParallaxOffset.x, this.currentParallaxOffset.y],
        };
        this.config.animationTargetValues = { ...targetValues };
        if (targetValues.positionOffset) {
            // Target is always relative to the original reference (startPos or currentPos for LastPosition)
            this.config.animationTargetValues.positionOffset = [
                animStartPos.x + targetValues.positionOffset[0],
                animStartPos.y + targetValues.positionOffset[1]
            ];
        }
        // RotationOffset is additive in the game: currentRotation + event.rotationOffset
        if (targetValues.rotationOffset !== undefined) {
            this.config.animationTargetValues.rotationOffset = (this.currentRotation - this.config.rotation) + targetValues.rotationOffset;
        }
        this.config.animating = true;
        this.config.animationStart = startTime;
        this.config.animationDuration = duration;
        this.config.animationEase = ease;
    }

    public reset(): void {
        this.config.animating = false;
        this.config.animationStartValues = {};
        this.config.animationTargetValues = {};
        this.config.visible = this.originalVisible;
        this.currentScale.set(this.config.scale[0] / 100, this.config.scale[1] / 100);
        this.currentRotation = this.config.rotation + this.config.rotationOffset;
        const [colorHex, colorAlpha] = parseDecoColor(this.config.color);
        this.currentColor.set(colorHex);
        this.currentOpacity = (this.config.opacity / 100) * colorAlpha;
        this.currentPosition.copy(this.startPos);
        this.pivotPos.copy(this.startPos);
        this.currentParallax.set(this.config.parallax[0] / 100, this.config.parallax[1] / 100);
        this.currentParallaxOffset.set(this.config.parallaxOffset[0], this.config.parallaxOffset[1]);
        this.container.visible = this.originalVisible;
        this.updateTransform();
    }

    public dispose(): void {
        this.clearVisual();
    }
}

export class DecorationManager {
    private scene: THREE.Scene;
    private container: THREE.Group;
    private levelData: any;
    private tileStartTimes: number[];
    private tileBPM: number[];
    private decorations: Map<string, DecorationInstance> = new Map();
    private taggedDecorations: Map<string, DecorationInstance[]> = new Map();
    private decorationEventsTimeline: { time: number; event: any }[] = [];
    private lastDecorationEventIndex: number = -1;
    private pendingDecorationEvents: any[] = [];
    private tileSize: number = 1.0;
    private textureLoader: THREE.TextureLoader;
    private textureCache: Map<string, THREE.Texture> = new Map();
    private customImages: Map<string, string> = new Map();
    private texturesLoading: Set<string> = new Set();
    private texturesLoaded: Set<string> = new Set();
    private placeholderTexture: THREE.Texture | null = null;

    constructor(scene: THREE.Scene, levelData: any, tileStartTimes: number[], tileBPM: number[]) {
        this.scene = scene;
        this.levelData = levelData;
        this.tileStartTimes = tileStartTimes;
        this.tileBPM = tileBPM;
        this.container = new THREE.Group();
        this.container.name = 'DecorationContainer';
        this.scene.add(this.container);
        this.textureLoader = new THREE.TextureLoader();
    }

    public init(): void {
        this.clear();
        const rootDecos = this.levelData.decorations || (this.levelData as any).__decorations || [];
        const tiles = this.levelData.tiles || [];

        for (const dec of rootDecos) {
            if (dec.eventType === 'AddDecoration' || dec.eventType === 'AddText' || dec.eventType === 'AddObject') {
                this.tryCreateDecoration(dec);
            }
        }
        for (const tile of tiles) {
            if (tile.addDecorations) {
                for (const dec of tile.addDecorations) {
                    if (dec.eventType === 'AddDecoration' || dec.eventType === 'AddText' || dec.eventType === 'AddObject') {
                        this.tryCreateDecoration({ ...dec, floor: dec.floor ?? tile.seqID ?? tiles.indexOf(tile) });
                    }
                }
            }
        }
        this.buildDecorationEventsTimeline();
    }

    private tryCreateDecoration(event: any): DecorationInstance | null {
        if (!isEventActive(event)) return null;
        const deco = this.createDecoration(event);
        if (!deco) this.pendingDecorationEvents.push(event);
        return deco;
    }

    private computeStartPos(position: [number, number], relativeTo: DecPlacementType, floor?: number): THREE.Vector2 {
        const tiles = this.levelData.tiles;
        const ts = this.tileSize;
        let pos = new THREE.Vector2(position[0] * ts, position[1] * ts);
        if (relativeTo === DecPlacementType.Tile && floor !== undefined && tiles?.[floor]?.position) {
            const tp = tiles[floor].position;
            pos.x += tp[0]; pos.y += tp[1];
        } else if (relativeTo === DecPlacementType.Camera || relativeTo === DecPlacementType.CameraAspect) {
            pos.x /= ts; pos.y /= ts;
        }
        return pos;
    }

    private createDecoration(event: any): DecorationInstance | null {
        if (!isEventActive(event)) return null;

        const relativeTo = this.parsePlacement(event.relativeTo);
        const rawPos = this.parseVec2(event.position, [0, 0]);
        const rawParallaxOffset = this.parseVec2(event.parallaxOffset, [0, 0]);
        const rawPivotOffset = this.parseVec2(event.pivotOffset, [0, 0]);
        const ts = this.tileSize;
        const isCam = relativeTo === DecPlacementType.Camera || relativeTo === DecPlacementType.CameraAspect;

        const floor = event.floor !== undefined ? event.floor
            : event.parentFloorNum !== undefined ? event.parentFloorNum
            : 0;
        const decoType = event.eventType === 'AddText' ? DecorationType.Text
            : event.eventType === 'AddObject' ? DecorationType.Object
            : DecorationType.Image;

        const config: Partial<DecorationConfig> = {
            decorationType: decoType,
            id: `dec_${event.eventType}_${floor ?? 0}_${Math.random().toString(36).slice(2, 6)}`,
            tag: event.tag || '',
            decorationImage: event.decorationImage || '',
            decText: event.decText || '',
            position: rawPos,
            positionOffset: this.parseVec2(event.positionOffset, [0, 0]),
            relativeTo,
            rotation: event.rotation || 0,
            rotationOffset: event.rotationOffset || 0,
            scale: this.parseVec2(event.scale, [100, 100]),
            parallax: this.parseVec2(event.parallax, [100, 100]),
            parallaxOffset: [rawParallaxOffset[0] * ts, rawParallaxOffset[1] * ts],
            pivotOffset: [rawPivotOffset[0] * (isCam ? 1 : ts), rawPivotOffset[1] * (isCam ? 1 : ts)],
            depth: event.depth || 0,
            color: event.color || 'ffffff',
            opacity: event.opacity !== undefined ? event.opacity : 100,
            lockScale: event.lockScale === true,
            lockRotation: event.lockRotation === true,
            visible: event.visible !== undefined ? event.visible : true,
            floor,
            objectType: event.objectType,
            planetColorType: event.planetColorType,
            planetColor: event.planetColor,
            planetTailColor: event.planetTailColor,
            trackColor: event.trackColor,
            trackColor2: event.trackColor2 || event.trackColor,
            trackOpacity: event.trackOpacity,
            trackStyle: event.trackStyle,
            trackIcon: event.trackIcon,
        };

        const deco = new DecorationInstance(config);
        deco.startPos.copy(this.computeStartPos(rawPos, relativeTo, floor));
        deco.pivotPos.copy(deco.startPos);
        deco.currentPosition.copy(deco.startPos);

        if (decoType === DecorationType.Text) {
            if (!this.setupTextVisual(deco, event)) { deco.dispose(); return null; }
        } else if (decoType === DecorationType.Object) {
            if (!this.setupObjectVisual(deco, event)) { deco.dispose(); return null; }
            deco.updateTransform();
        } else {
            if (!config.decorationImage) { deco.dispose(); return null; }
            if (!this.loadDecoTexture(config.decorationImage, deco)) { deco.dispose(); return null; }
        }

        this.registerDecoration(deco);
        return deco;
    }

    private setupTextVisual(deco: DecorationInstance, event: any): boolean {
        const canvas = document.createElement('canvas');
        canvas.width = 1024; canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, 1024, 256);
        const [textColor] = parseDecoColor(event.color, 'ffffff');
        ctx.fillStyle = textColor;
        ctx.font = `bold ${event.fontSize || 48}px ${event.font || 'Arial'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = event.decText || '';
        const lines = text.split('\n');
        const lineH = (event.fontSize || 48) * 1.3;
        const startY = 128 - (lines.length - 1) * lineH / 2;
        lines.forEach((l: string, i: number) => {
            ctx.fillText(l, 512, startY + i * lineH);
        });
        const texture = new THREE.CanvasTexture(canvas);
        deco.setupVisual(texture);
        return true;
    }

    private setupObjectVisual(deco: DecorationInstance, event: any): boolean {
        const g = new THREE.Group();
        const objType = event.objectType || 'Planet';
        if (objType === 'Planet') {
            const [pColor, pAlpha] = parseDecoColor(event.planetColor, 'ffffff');
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pColor), transparent: true, opacity: pAlpha });
            const sphere = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), mat);
            g.add(sphere);
            if (event.planetTailColor) {
                const [tColor, tAlpha] = parseDecoColor(event.planetTailColor, 'ffffff');
                const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tColor), transparent: true, opacity: tAlpha * 0.5 });
                const tail = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), tailMat);
                g.add(tail);
            }
        } else if (objType === 'Floor') {
            const trackAngle = event.trackAngle ?? 0;
            // Official ADOFAI: angle0 = -180 (fixed), angle1 = 180 - trackAngle
            // trackAngle=90 → angle1=90 → 270° arc
            // trackAngle=0 → angle1=180 → 360° arc
            // trackAngle=360 → angle1=-180 → midspin degenerate
            const angle0 = -180;
            const angle1 = 180 - trackAngle;
            const isMidspin = event.trackType === 'Midspin' || event.trackType === 'midspin';
            const trackStyle = event.trackStyle || 'Standard';

            // Use createTrackMesh to generate the proper tile mesh
            const meshData = isMidspin
                ? createTrackMesh(-180, 0, true, undefined, undefined, undefined, trackStyle)
                : createTrackMesh(angle0, angle1, false, undefined, undefined, undefined, trackStyle);
            const trackOpacity = event.trackOpacity !== undefined ? event.trackOpacity / 100 : 1;
            if (meshData && meshData.faces && meshData.faces.length > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setIndex(meshData.faces);
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshData.vertices, 3));
                geometry.setAttribute('color', new THREE.Float32BufferAttribute([...meshData.colors], 3));
                geometry.computeVertexNormals();

                // Apply colors using mask-based approach (matching Player.ts)
                const trackColor = event.trackColor;
                const trackColor2 = event.trackColor2 || trackColor;

                if (trackColor) {
                    const [fillHex] = parseDecoColor(trackColor, 'ffffff');
                    const [borderHex] = parseDecoColor(trackColor2, 'ffffff');
                    const cFill = new THREE.Color(fillHex);
                    const cBorder = new THREE.Color(borderHex);
                    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
                    const colorArray = colorAttr.array as Float32Array;
                    const maskArray = meshData.colors;

                    // Same logic as Player.ts: mask < 0.5 → border, else → fill
                    for (let i = 0; i < colorArray.length; i += 3) {
                        if (maskArray[i] < 0.5) {
                            colorArray[i] = cBorder.r;
                            colorArray[i + 1] = cBorder.g;
                            colorArray[i + 2] = cBorder.b;
                        } else {
                            colorArray[i] = cFill.r;
                            colorArray[i + 1] = cFill.g;
                            colorArray[i + 2] = cFill.b;
                        }
                    }
                    colorAttr.needsUpdate = true;
                }

                const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: trackOpacity < 1, opacity: trackOpacity, side: THREE.DoubleSide });
                const tileMesh = new THREE.Mesh(geometry, mat);
                g.add(tileMesh);
            }

            // Track icon overlay using PNG sprites (matching ADOFAI CustomFloorIcon)
            const trackIcon = event.trackIcon;
            if (trackIcon && trackIcon !== 'None') {
                const texType = getIconTextureForCustomFloor(trackIcon);
                if (texType) {
                    const tex = getIconTexture(texType);
                    const sprite = createIconSprite(tex, trackOpacity, 0.44);
                    sprite.position.set(0, 0, 0.005);
                    g.add(sprite);
                    deco.iconSprite = sprite;
                }
            }
        } else if (objType === 'PlayerBubble') {
            const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
            const bubble = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), mat);
            g.add(bubble);
        }
        deco.objectGroup = g;
        deco.container.add(g);
        return true;
    }

    private loadDecoTexture(filename: string, deco: DecorationInstance): boolean {
        const cached = this.textureCache.get(filename);
        if (cached) { deco.setupVisual(cached); return true; }
        const url = this.findImageUrl(filename);
        if (url && !this.texturesLoading.has(filename)) {
            this.texturesLoading.add(filename);
            this.textureLoader.load(url, (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                this.textureCache.set(filename, tex);
                this.texturesLoaded.add(filename);
                this.texturesLoading.delete(filename);
                deco.setupVisual(tex);
            }, undefined, () => {
                this.texturesLoading.delete(filename);
            });
            return true;
        }
        return false;
    }

    private findImageUrl(filename: string): string | undefined {
        let u = this.customImages.get(filename);
        if (u) return u;
        const base = filename.split(/[/\\]/).pop()!;
        u = this.customImages.get(base);
        if (u) return u;
        for (const [k, v] of this.customImages) {
            if (k.endsWith(filename) || filename.endsWith(k)) return v;
        }
        return undefined;
    }

    private registerDecoration(deco: DecorationInstance): void {
        this.decorations.set(deco.config.id!, deco);
        this.container.add(deco.container);
        if (deco.config.tag) {
            const tags = deco.config.tag.split(/\s+/).filter(Boolean);
            for (const t of tags) {
                if (!this.taggedDecorations.has(t)) this.taggedDecorations.set(t, []);
                this.taggedDecorations.get(t)!.push(deco);
            }
        }
        deco.container.visible = deco.config.visible ?? true;
    }

    private buildDecorationEventsTimeline(): void {
        this.decorationEventsTimeline = [];
        const actions = this.levelData.actions || [];

        // Collect all decoration events grouped by floor (matching CameraController.buildCameraTimeline)
        const byFloor = new Map<number, any[]>();
        for (const action of actions) {
            if (action.eventType === 'MoveDecorations' || action.eventType === 'SetText' || action.eventType === 'SetObject') {
                const floor = action.floor ?? 0;
                if (!byFloor.has(floor)) byFloor.set(floor, []);
                byFloor.get(floor)!.push(action);
            }
        }

        const entries: { time: number; event: any }[] = [];

        byFloor.forEach((events, floor) => {
            const startTime = this.tileStartTimes[floor] || 0;
            const bpm = this.tileBPM[floor] || 100;
            const secPerBeat = 60 / bpm;

            // Sort by event id for stable ordering within same floor
            const sorted = [...events].sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity));
            const zeroOffsetEvents = sorted.filter(e => (e.angleOffset || 0) === 0);

            sorted.forEach((event) => {
                const ao = event.angleOffset || 0;
                let offset = (ao / 180) * secPerBeat;
                // Micro-offset for multiple zero-angleOffset events (matching camera)
                if (ao === 0 && zeroOffsetEvents.length > 1) {
                    const order = zeroOffsetEvents.findIndex(e => e.id === event.id);
                    offset += order * 0.0001;
                }
                entries.push({ time: startTime + offset, event });
            });
        });

        // Global sort by time, then by id for ties
        entries.sort((a, b) => {
            const dt = a.time - b.time;
            return Math.abs(dt) < 0.0001
                ? ((a.event.id ?? Infinity) - (b.event.id ?? Infinity))
                : (dt > 0 ? 1 : -1);
        });

        this.decorationEventsTimeline = entries;
    }

    public registerCustomImage(filename: string, url: string): void {
        this.customImages.set(filename, url);
        const base = filename.split(/[/\\]/).pop()!;
        if (base !== filename) this.customImages.set(base, url);
        const existing = this.textureCache.get(filename);
        if (existing) { existing.dispose(); this.textureCache.delete(filename); }
        this.texturesLoaded.delete(filename);
        this.retryPending();
    }

    private retryPending(): void {
        const remaining: any[] = [];
        for (const event of this.pendingDecorationEvents) {
            const deco = this.createDecoration(event);
            if (!deco) remaining.push(event);
        }
        this.pendingDecorationEvents = remaining;
    }

    public async preloadTextures(): Promise<number> {
        const filenames = new Set<string>();
        this.decorations.forEach(d => { if (d.config.decorationImage) filenames.add(d.config.decorationImage); });
        this.pendingDecorationEvents.forEach((e: any) => { if (e.decorationImage) filenames.add(e.decorationImage); });
        if (filenames.size === 0) return 0;
        const promises: Promise<void>[] = [];
        for (const fn of filenames) {
            promises.push(new Promise((resolve) => {
                if (this.textureCache.has(fn)) { resolve(); return; }
                const url = this.findImageUrl(fn);
                if (!url) { resolve(); return; }
                this.texturesLoading.add(fn);
                this.textureLoader.load(url, (tex) => {
                    tex.colorSpace = THREE.SRGBColorSpace;
                    this.textureCache.set(fn, tex);
                    this.texturesLoaded.add(fn);
                    this.texturesLoading.delete(fn);
                    resolve();
                }, undefined, () => { this.texturesLoading.delete(fn); resolve(); });
            }));
        }
        await Promise.all(promises);
        this.retryPending();
        this.decorations.forEach(d => {
            if (d.config.decorationImage) {
                const tex = this.textureCache.get(d.config.decorationImage);
                if (tex) { d.setupVisual(tex); }
            }
        });
        return this.texturesLoaded.size;
    }

    public update(elapsedTime: number, cameraPosition: THREE.Vector3, cameraRotation: number, cameraZoom: number): void {
        const now = elapsedTime / 1000;
        this.processEvents(now);
        const vr = 20 / cameraZoom + 5;
        const minX = cameraPosition.x - vr, maxX = cameraPosition.x + vr;
        const minY = cameraPosition.y - vr, maxY = cameraPosition.y + vr;
        this.decorations.forEach(d => {
            if (d.config.animating) d.updateAnimation(now);
            d.updatePosition(cameraPosition, cameraRotation, cameraZoom);
            const p = d.container.position;
            const vis = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
            if (d.container.visible !== vis && d.config.visible) d.container.visible = vis;
        });
    }

    private processEvents(now: number): void {
        if (this.lastDecorationEventIndex >= 0 && this.lastDecorationEventIndex < this.decorationEventsTimeline.length) {
            const last = this.decorationEventsTimeline[this.lastDecorationEventIndex];
            if (last && now < last.time) {
                this.decorations.forEach(d => d.reset());
                this.lastDecorationEventIndex = -1;
            }
        }
        let safety = 0;
        while (safety < (this.decorationEventsTimeline.length + 10) &&
               this.lastDecorationEventIndex + 1 < this.decorationEventsTimeline.length &&
               this.decorationEventsTimeline[this.lastDecorationEventIndex + 1].time <= now) {
            this.lastDecorationEventIndex++;
            const entry = this.decorationEventsTimeline[this.lastDecorationEventIndex];
            if (entry) this.processEvent(entry.event, now);
            safety++;
        }
    }

    private processEvent(event: any, now: number): void {
        if (!isEventActive(event)) return;
        if (event.eventType === 'MoveDecorations') {
            this.processMoveDecorations(event, now);
        } else if (event.eventType === 'SetText') {
            this.processSetText(event);
        } else if (event.eventType === 'SetObject') {
            this.processSetObject(event);
        }
    }

    private processMoveDecorations(event: any, now: number): void {
        const tagStr = event.tag || '';
        if (!tagStr) return;
        const tags = tagStr.split(/\s+/).filter(Boolean);
        const floor = event.floor;
        const bpm = this.tileBPM[floor] || 100;
        const duration = (event.duration || 0) * 60 / bpm;
        const movementType = this.parsePlacement(event.relativeTo);
        const ts = this.tileSize;

        for (const tag of tags) {
            const list = this.taggedDecorations.get(tag);
            if (!list) continue;
            for (const deco of list) {
                const target: Partial<DecorationConfig> = {};

                if (event.positionOffset !== undefined && !event.disabled?.positionOffset) {
                    const pos = this.parseVec2(event.positionOffset, [0, 0]);
                    target.positionOffset = [pos[0] * ts, pos[1] * ts];
                }
                if (event.rotationOffset !== undefined && !event.disabled?.rotationOffset) {
                    target.rotationOffset = event.rotationOffset;
                }
                if (event.scale !== undefined && !event.disabled?.scale) {
                    const s = this.parseVec2(event.scale, [100, 100]);
                    target.scale = [s[0], s[1]];
                }
                if (event.color !== undefined && !event.disabled?.color) {
                    target.color = event.color;
                }
                if (event.opacity !== undefined && !event.disabled?.opacity) {
                    target.opacity = event.opacity;
                }
                if (event.parallax !== undefined && !event.disabled?.parallax) {
                    const p = this.parseVec2(event.parallax, [100, 100]);
                    target.parallax = [p[0] / 100, p[1] / 100];
                }
                if (event.parallaxOffset !== undefined && !event.disabled?.parallaxOffset) {
                    const po = this.parseVec2(event.parallaxOffset, [0, 0]);
                    target.parallaxOffset = [po[0] * ts, po[1] * ts];
                }
                if (event.pivotOffset !== undefined && !event.disabled?.pivotOffset) {
                    const piv = this.parseVec2(event.pivotOffset, [0, 0]);
                    target.pivotOffset = [piv[0] * ts, piv[1] * ts];
                }
                if (event.depth !== undefined && !event.disabled?.depth) {
                    target.depth = event.depth;
                }
                if (event.visible !== undefined && !event.disabled?.visible) {
                    target.visible = event.visible;
                }
                if (event.decorationImage !== undefined && !event.disabled?.decorationImage) {
                    target.decorationImage = event.decorationImage;
                }

                deco.startAnimation(target, duration, event.ease || 'Linear', now, movementType);
            }
        }
    }

    private processSetText(event: any): void {
        const tags = (event.tag || '').split(/\s+/).filter(Boolean);
        const text = event.decText || '';
        for (const tag of tags) {
            const list = this.taggedDecorations.get(tag);
            if (!list) continue;
            for (const deco of list) {
                if (deco.config.decorationType !== DecorationType.Text) continue;
                deco.config.decText = text;
                this.setupTextVisual(deco, event);
            }
        }
    }

    private processSetObject(event: any): void {
        const tags = (event.tag || '').split(/\s+/).filter(Boolean);
        for (const tag of tags) {
            const list = this.taggedDecorations.get(tag);
            if (!list) continue;
            for (const deco of list) {
                if (deco.config.decorationType !== DecorationType.Object) continue;
                if (deco.config.objectType === 'Planet') {
                    if (event.planetColor !== undefined && !event.disabled?.planetColor) {
                        const [hex, alpha] = parseDecoColor(event.planetColor, 'ffffff');
                        deco.config.planetColor = event.planetColor;
                        deco.currentColor.set(hex);
                        deco.currentOpacity *= alpha;
                    }
                    if (event.planetTailColor !== undefined && !event.disabled?.planetTailColor) {
                        deco.config.planetTailColor = event.planetTailColor;
                    }
                } else if (deco.config.objectType === 'Floor') {
                    if (event.trackColor !== undefined && !event.disabled?.trackColor) {
                        deco.config.trackColor = event.trackColor;
                    }
                    if (event.trackOpacity !== undefined && !event.disabled?.opacity) {
                        deco.config.trackOpacity = event.trackOpacity;
                        deco.currentOpacity = event.trackOpacity / 100;
                    }
                    if (event.trackIcon !== undefined && !event.disabled?.trackIcon) {
                        deco.config.trackIcon = event.trackIcon;
                        this.rebuildFloorIcon(deco);
                    }
                }
                deco.updateTransform();
            }
        }
    }

    private rebuildFloorIcon(deco: DecorationInstance): void {
        if (deco.iconSprite && deco.objectGroup) {
            deco.objectGroup.remove(deco.iconSprite);
            (deco.iconSprite.material as THREE.Material).dispose();
            deco.iconSprite = null;
        }
        const trackIcon = deco.config.trackIcon;
        if (!trackIcon || trackIcon === 'None' || !deco.objectGroup) return;
        const texType = getIconTextureForCustomFloor(trackIcon);
        if (texType) {
            const tex = getIconTexture(texType);
            const sprite = createIconSprite(tex, deco.currentOpacity, 0.44);
            sprite.position.set(0, 0, 0.005);
            deco.objectGroup.add(sprite);
            deco.iconSprite = sprite;
        }
    }

    public reset(): void {
        this.decorations.forEach(d => d.reset());
        this.lastDecorationEventIndex = -1;
    }

    public clear(): void {
        this.decorations.forEach(d => { d.dispose(); this.container.remove(d.container); });
        this.decorations.clear();
        this.taggedDecorations.clear();
        this.decorationEventsTimeline = [];
        this.lastDecorationEventIndex = -1;
    }

    public dispose(): void {
        this.clear();
        this.textureCache.forEach(t => t.dispose());
        this.textureCache.clear();
        if (this.placeholderTexture) { this.placeholderTexture.dispose(); this.placeholderTexture = null; }
        this.scene.remove(this.container);
    }

    private parsePlacement(v: any): DecPlacementType {
        if (!v) return DecPlacementType.Tile;
        switch (v) {
            case 'Camera': case DecPlacementType.Camera: return DecPlacementType.Camera;
            case 'CameraAspect': case DecPlacementType.CameraAspect: return DecPlacementType.CameraAspect;
            case 'LastPosition': case DecPlacementType.LastPosition: return DecPlacementType.LastPosition;
            default: return DecPlacementType.Tile;
        }
    }

    private parseVec2(v: any, def: [number, number]): [number, number] {
        if (!v) return def;
        if (Array.isArray(v) && v.length >= 2) return [Number(v[0]), Number(v[1])];
        // Handle string vectors like "[1, 2]" or "(1, 2)"
        if (typeof v === 'string') {
            const m = v.match(/-?\d+\.?\d*/g);
            if (m && m.length >= 2) return [parseFloat(m[0]), parseFloat(m[1])];
        }
        return def;
    }
}

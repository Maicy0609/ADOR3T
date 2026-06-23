import { Color, Mesh, MeshBasicMaterial, Scene, OrthographicCamera, PlaneGeometry, WebGLRenderer } from 'three';
import { EasingFunctions } from './Easing';

interface FlashTransition {
    active: boolean;
    startTime: number;
    duration: number;
    startColor: Color;
    endColor: Color;
    startOpacity: number;
    endOpacity: number;
    ease: string;
    flashStyle: string; // 'Flash' | 'Reverse' | 'StayBlack' | 'Kill' | 'FlashEx'
}

function easeOutQuad(t: number): number {
    return t * (2 - t);
}

export class FlashEffect {
    private enabled: boolean = true;

    private fgTransition: FlashTransition;
    private bgTransition: FlashTransition;

    private fgQuad: Mesh;
    private bgQuad: Mesh;
    private fgMaterial: MeshBasicMaterial;
    private bgMaterial: MeshBasicMaterial;
    private scene: Scene;
    private camera: OrthographicCamera;

    constructor() {
        const defaultTransition = (): FlashTransition => ({
            active: false,
            startTime: 0,
            duration: 0,
            startColor: new Color(1, 1, 1),
            endColor: new Color(0, 0, 0),
            startOpacity: 0,
            endOpacity: 0,
            ease: 'Linear',
            flashStyle: 'Flash',
        });
        this.fgTransition = defaultTransition();
        this.bgTransition = defaultTransition();

        this.fgMaterial = new MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
        });
        this.bgMaterial = new MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false,
        });

        this.scene = new Scene();
        this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const geometry = new PlaneGeometry(2, 2);
        this.bgQuad = new Mesh(geometry, this.bgMaterial);
        this.bgQuad.position.z = -1;
        this.bgQuad.renderOrder = 1000;
        this.scene.add(this.bgQuad);

        this.fgQuad = new Mesh(geometry, this.fgMaterial);
        this.fgQuad.position.z = -0.5;
        this.fgQuad.renderOrder = 1001;
        this.scene.add(this.fgQuad);
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    getEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Handle all Flash event modes.
     *
     * Supports both old format (color, colorTo, opacity, easing, flashStyle, duration)
     * and new format (startColor, endColor, startOpacity, endOpacity, ease, plane, duration).
     *
     * flashStyle values:
     *   "Flash"      – fade from color(×opacity) → transparent
     *   "Reverse"    – fade from current → color over duration
     *   "StayBlack"  – immediately set black, stays
     *   "Kill"       – immediately stop all flash
     *   "FlashEx"    – fade from color → colorTo over duration
     */
    startFlash(
        currentTime: number,
        event: any,
        plane: 'FG' | 'BG',
    ): void {
        const flashStyle = event.flashStyle || 'Flash';

        // Handle instant modes first
        if (flashStyle === 'Kill') {
            this.stop();
            return;
        }
        if (flashStyle === 'StayBlack') {
            const transition = plane === 'FG' ? this.fgTransition : this.bgTransition;
            transition.active = true;
            transition.startTime = currentTime;
            transition.duration = 0;
            transition.startColor.set(0, 0, 0);
            transition.endColor.set(0, 0, 0);
            transition.startOpacity = 1;
            transition.endOpacity = 1;
            transition.ease = 'Linear';
            transition.flashStyle = 'StayBlack';

            const material = plane === 'FG' ? this.fgMaterial : this.bgMaterial;
            material.color.set(0, 0, 0);
            material.opacity = 1;
            return;
        }

        let startColorStr = event.startColor || event.color || 'ffffff';
        let endColorStr = event.endColor || event.colorTo || 'ffffff';
        let startOpacity: number;
        let endOpacity: number;
        let ease = event.ease || event.easing || 'Linear';
        let duration = event.duration ?? 1;

        if (flashStyle === 'Reverse') {
            // Start from current color/opacity, end at target
            const transition = plane === 'FG' ? this.fgTransition : this.bgTransition;
            const material = plane === 'FG' ? this.fgMaterial : this.bgMaterial;
            startColorStr = this.colorToHex(material.color);
            startOpacity = material.opacity;
            endColorStr = event.color || 'ffffff';
            endOpacity = event.opacity !== undefined ? event.opacity / 100 : 1;
        } else if (flashStyle === 'FlashEx') {
            // Explicit start/end
            startColorStr = event.color || 'ffffff';
            endColorStr = event.colorTo || 'ffffff';
            startOpacity = (event.opacity !== undefined ? event.opacity : 100) / 100;
            endOpacity = 0;
        } else {
            // Standard Flash: same as ffxFlashPlus or legacy Flash
            startOpacity = event.startOpacity !== undefined
                ? event.startOpacity / 100
                : (event.opacity !== undefined ? event.opacity / 100 : 1);
            endOpacity = event.endOpacity !== undefined
                ? event.endOpacity / 100
                : 0;
        }

        const transition = plane === 'FG' ? this.fgTransition : this.bgTransition;
        const material = plane === 'FG' ? this.fgMaterial : this.bgMaterial;

        transition.active = true;
        transition.startTime = currentTime;
        transition.duration = duration;
        transition.startColor.set(this.normalizeHexColor(startColorStr));
        transition.endColor.set(this.normalizeHexColor(endColorStr));
        transition.startOpacity = startOpacity;
        transition.endOpacity = endOpacity;
        transition.ease = ease;
        transition.flashStyle = flashStyle;

        material.color.copy(transition.startColor);
        material.opacity = transition.startOpacity;
    }

    private colorToHex(color: Color): string {
        const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
        return r + g + b;
    }

    private normalizeHexColor(hex: string): string {
        let result = hex.startsWith('#') ? hex.slice(1) : hex;
        if (result.length === 8) result = result.slice(0, 6);
        return '#' + result;
    }

    private updateTransition(
        transition: FlashTransition,
        material: MeshBasicMaterial,
        currentTime: number,
    ): boolean {
        if (!transition.active) return false;

        if (transition.flashStyle === 'StayBlack') {
            // Persists until killed
            return true;
        }

        if (transition.duration <= 0) {
            material.color.copy(transition.endColor);
            material.opacity = transition.endOpacity;
            transition.active = false;
            return false;
        }

        const elapsed = currentTime - transition.startTime;
        let t = elapsed / transition.duration;

        let finished = false;
        if (t >= 1) {
            t = 1;
            finished = true;
        } else if (t < 0) {
            t = 0;
        }

        const easeFunc = EasingFunctions[transition.ease] || EasingFunctions.Linear || easeOutQuad;
        const progress = easeFunc(t);

        material.color.lerpColors(transition.startColor, transition.endColor, progress);
        material.opacity = transition.startOpacity + (transition.endOpacity - transition.startOpacity) * progress;

        if (finished) {
            transition.active = false;
        }

        return !finished;
    }

    isActive(): boolean {
        return this.fgTransition.active || this.bgTransition.active;
    }

    isFGActive(): boolean {
        return this.fgTransition.active;
    }

    isBGActive(): boolean {
        return this.bgTransition.active;
    }

    renderFlash(renderer: WebGLRenderer, currentTime: number): void {
        if (!this.enabled) return;

        // Update StayBlack persisted state
        if (this.fgTransition.active && this.fgTransition.flashStyle === 'StayBlack') {
            this.fgMaterial.color.set(0, 0, 0);
            this.fgMaterial.opacity = 1;
        }
        if (this.bgTransition.active && this.bgTransition.flashStyle === 'StayBlack') {
            this.bgMaterial.color.set(0, 0, 0);
            this.bgMaterial.opacity = 1;
        }

        const fgActive = this.updateTransition(this.fgTransition, this.fgMaterial, currentTime);
        const bgActive = this.updateTransition(this.bgTransition, this.bgMaterial, currentTime);

        const fgVisible = this.fgMaterial.opacity > 0.001;
        const bgVisible = this.bgMaterial.opacity > 0.001;

        if (!fgVisible && !bgVisible) return;

        const oldAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(this.scene, this.camera);
        renderer.autoClear = oldAutoClear;
    }

    getFGOpacity(): number {
        return this.fgMaterial.opacity;
    }

    getBGOpacity(): number {
        return this.bgMaterial.opacity;
    }

    stop(): void {
        this.fgTransition.active = false;
        this.bgTransition.active = false;
        this.fgMaterial.opacity = 0;
        this.bgMaterial.opacity = 0;
    }

    reset(): void {
        this.stop();
        this.fgTransition.startColor.set(1, 1, 1);
        this.fgTransition.endColor.set(0, 0, 0);
        this.fgTransition.startOpacity = 0;
        this.fgTransition.endOpacity = 0;
        this.fgTransition.flashStyle = 'Flash';
        this.bgTransition.startColor.set(1, 1, 1);
        this.bgTransition.endColor.set(0, 0, 0);
        this.bgTransition.startOpacity = 0;
        this.bgTransition.endOpacity = 0;
        this.bgTransition.flashStyle = 'Flash';
        this.fgMaterial.color.set(1, 1, 1);
        this.bgMaterial.color.set(1, 1, 1);
    }

    setSize(width: number, height: number): void {
    }

    dispose(): void {
        this.fgMaterial.dispose();
        this.bgMaterial.dispose();
        this.fgQuad.geometry.dispose();
        this.bgQuad.geometry.dispose();
    }
}

export default FlashEffect;

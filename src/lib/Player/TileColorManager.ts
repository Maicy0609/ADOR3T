import * as THREE from 'three';

/**
 * Check if an event is active (should be processed)
 * active: undefined | true | "" | "Enabled" -> active (process event)
 * active: false | "Disabled" -> inactive (skip event)
 */
export const isEventActive = (event: any): boolean => {
    if (event.active === undefined) return true;
    if (event.active === true) return true;
    if (event.active === "") return true;
    if (event.active === "Enabled") return true;
    if (event.active === false) return false;
    if (event.active === "Disabled") return false;
    // Default to active for unknown values
    return true;
};

/**
 * Tile color configuration
 */
export interface TileColorConfig {
    trackStyle: string;
    trackColorType: string;
    trackColor: string;
    secondaryTrackColor: string;
    trackColorPulse: string;
    trackColorAnimDuration: number;
    trackPulseLength: number;
    trackColorAlpha: number;  // Alpha channel for track color (0-1)
    secondaryTrackColorAlpha: number;  // Alpha channel for secondary color (0-1)
}

/**
 * Manager for tile colors and color events
 */
export class TileColorManager {
    private tileColors: { color: string, secondaryColor: string }[] = [];
    private tileRecolorConfigs: (TileColorConfig | null)[] = [];
    private levelData: any;
    
    constructor(levelData: any) {
        this.levelData = levelData;
    }

    /**
     * Parse color string and extract RGB and Alpha components
     * @param colorStr Color string in hex format (with or without alpha)
     * @returns Object with r, g, b, a values (0-1)
     */
    private parseColorRGBA(colorStr: string): { r: number, g: number, b: number, a: number } {
        const color = new THREE.Color(colorStr);
        const r = color.r;
        const g = color.g;
        const b = color.b;

        // Parse alpha from hex string if present (#RRGGBBAA or #RGBA)
        let a = 1.0;
        const hex = colorStr.replace('#', '');
        
        if (hex.length === 8) {
            // #RRGGBBAA format
            a = parseInt(hex.substring(6, 8), 16) / 255;
        } else if (hex.length === 4) {
            // #RGBA format
            a = parseInt(hex.substring(3, 4) + hex.substring(3, 4), 16) / 255;
        }

        return { r, g, b, a };
    }

    /**
     * Extract alpha channel from color string
     * @param colorStr Color string in hex format
     * @returns Alpha value (0-1)
     */
    public extractAlpha(colorStr: string): number {
        const hex = colorStr.replace('#', '');
        
        if (hex.length === 8) {
            // #RRGGBBAA format
            return parseInt(hex.substring(6, 8), 16) / 255;
        } else if (hex.length === 4) {
            // #RGBA format
            return parseInt(hex.substring(3, 4) + hex.substring(3, 4), 16) / 255;
        }
        
        return 1.0; // Default alpha
    }

    /**
     * Convert RGB to hex string (6 digits)
     */
    private rgbToHex(r: number, g: number, b: number): string {
        const toHex = (n: number) => {
            const hex = Math.round(n * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    
    /**
     * Initialize tile colors from level settings
     */
    public initTileColors(): void {
        const totalTiles = this.levelData.tiles.length;
        const settings = this.levelData.settings;
        
        // Global defaults
        const defaultColor = settings.trackColor || 'debb7b';
        const defaultSecondaryColor = settings.secondaryTrackColor || 'ffffff';
        const defaultStyle = settings.trackStyle || 'Standard';
        const defaultColorType = settings.trackColorType || 'Single';

        // Initialize tileColors and configs
        this.tileColors = new Array(totalTiles);
        this.tileRecolorConfigs = new Array(totalTiles).fill(null);

        const globalConfig: TileColorConfig = {
            trackStyle: defaultStyle,
            trackColorType: defaultColorType,
            trackColor: defaultColor,  // Use original colors
            secondaryTrackColor: defaultSecondaryColor,  // Use original colors
            trackColorPulse: settings.trackColorPulse || 'None',
            trackColorAnimDuration: settings.trackColorAnimDuration || 2,
            trackPulseLength: settings.trackPulseLength || 10,
            trackColorAlpha: this.extractAlpha(defaultColor),
            secondaryTrackColorAlpha: this.extractAlpha(defaultSecondaryColor)
        };

        // Optimization: Sort non-justThisTile events to process in one pass (O(N + E log E))
        const colorTrackEvents: any[] = [];
        if (this.levelData.actions) {
            this.levelData.actions.forEach((event: any) => {
                if (event.eventType === 'ColorTrack' && !event.justThisTile) {
                    colorTrackEvents.push(event);
                }
            });
        }
        colorTrackEvents.sort((a, b) => a.floor - b.floor);

        let currentEventIdx = 0;
        let currentConfig = globalConfig;

        for (let i = 0; i < totalTiles; i++) {
            // Update currentConfig if we reached a new ColorTrack floor
            while (currentEventIdx < colorTrackEvents.length && colorTrackEvents[currentEventIdx].floor <= i) {
                const event = colorTrackEvents[currentEventIdx];
                const eventTrackStyle = event.trackStyle || defaultStyle;

                currentConfig = {
                    trackStyle: eventTrackStyle,
                    trackColorType: event.trackColorType || defaultColorType,
                    trackColor: event.trackColor || defaultColor,  // Use original colors
                    secondaryTrackColor: event.secondaryTrackColor || defaultSecondaryColor,  // Use original colors
                    trackColorPulse: event.trackColorPulse || settings.trackColorPulse || 'None',
                    trackColorAnimDuration: event.trackColorAnimDuration || settings.trackColorAnimDuration || 2,
                    trackPulseLength: event.trackPulseLength || settings.trackPulseLength || 10,
                    trackColorAlpha: this.extractAlpha(event.trackColor || defaultColor),
                    secondaryTrackColorAlpha: this.extractAlpha(event.secondaryTrackColor || defaultSecondaryColor)
                };
                currentEventIdx++;
            }

            this.tileRecolorConfigs[i] = currentConfig;
            const rendered = this.getTileRenderer(i, 0, currentConfig);
            this.tileColors[i] = { color: rendered.color, secondaryColor: rendered.bgcolor };
        }

        // Handle justThisTile events (Static Preview Logic) separately as O(1)
        if (this.levelData.actions) {
            this.levelData.actions.forEach((event: any) => {
                if (event.eventType === 'ColorTrack' && event.justThisTile) {
                    const floor = event.floor;
                    if (floor >= 0 && floor < totalTiles) {
                        const config: TileColorConfig = {
                            trackStyle: event.trackStyle || defaultStyle,
                            trackColorType: event.trackColorType || defaultColorType,
                            trackColor: event.trackColor || defaultColor,  // Use original colors
                            secondaryTrackColor: event.secondaryTrackColor || defaultSecondaryColor,  // Use original colors
                            trackColorPulse: event.trackColorPulse || settings.trackColorPulse || 'None',
                            trackColorAnimDuration: event.trackColorAnimDuration || settings.trackColorAnimDuration || 2,
                            trackPulseLength: event.trackPulseLength || settings.trackPulseLength || 10,
                            trackColorAlpha: this.extractAlpha(event.trackColor || defaultColor),
                            secondaryTrackColorAlpha: this.extractAlpha(event.secondaryTrackColor || defaultSecondaryColor)
                        };

                        this.tileRecolorConfigs[floor] = config;
                        const rendered = this.getTileRenderer(floor, 0, config);
                        this.tileColors[floor] = { color: rendered.color, secondaryColor: rendered.bgcolor };
                    }
                }
            });
        }
    }
    
    public getTileColors(): { color: string, secondaryColor: string }[] {
        return this.tileColors;
    }
    
    public getTileRecolorConfigs(): (TileColorConfig | null)[] {
        return this.tileRecolorConfigs;
    }
    
    public getTileColor(index: number): { color: string, secondaryColor: string, shadowAlpha: number } | undefined {
        return this.tileColors[index];
    }
    
    public getTileRecolorConfig(index: number): TileColorConfig | null {
        return this.tileRecolorConfigs[index];
    }
    
    public setTileColor(index: number, color: string, bgcolor: string, shadowAlpha: number = 1.0): void {
        if (index >= 0 && index < this.tileColors.length) {
            this.tileColors[index] = { color, secondaryColor: bgcolor, shadowAlpha };
        }
    }
    
    public setTileRecolorConfig(index: number, config: TileColorConfig): void {
        if (index >= 0 && index < this.tileRecolorConfigs.length) {
            this.tileRecolorConfigs[index] = config;
        }
    }
    
    public getTotalTiles(): number {
        return this.tileColors.length;
    }

    /**
     * Process position relative keywords
     */
    /**
     * Parse tile reference to absolute tile index
     * ADOFAI format: [offset, relativeTo] where relativeTo is:
     *   - "ThisTile" or 0: relative to current tile (event floor)
     *   - "Start" or 1: relative to start of level
     *   - "End" or 2: relative to end of level
     * 
     * @param input The tile reference (can be array [offset, relativeTo] or single number)
     * @param thisid The current tile ID (floor where event occurs)
     * @returns Absolute tile index
     */
    public PosRelativeTo(input: any, thisid: number): number {
        const totalTiles = this.levelData.tiles.length;

        // Handle array format [offset, relativeTo]
        if (Array.isArray(input) && input.length >= 2) {
            const offset = Number(input[0]) || 0;
            const relativeTo = input[1];
            
            let result: number;
            
            // Parse relativeTo (can be string or number)
            if (relativeTo === "ThisTile" || relativeTo === 0) {
                // Relative to current tile
                result = thisid + offset;
            } else if (relativeTo === "Start" || relativeTo === 1) {
                // Relative to start (absolute position)
                result = offset;
            } else if (relativeTo === "End" || relativeTo === 2) {
                // Relative to end (from last tile)
                result = totalTiles - 1 + offset;
            } else {
                // Default: treat as ThisTile
                result = thisid + offset;
            }
            
            // Clamp to valid range
            return Math.max(0, Math.min(result, totalTiles - 1));
        }
        
        // Handle legacy string format with keywords
        if (typeof input === 'string') {
            const replaced = input
                .replace(/Start/g, "0")
                .replace(/ThisTile/g, String(thisid))
                .replace(/End/g, String(totalTiles - 1));
            return Math.max(0, Math.min(Number(replaced), totalTiles - 1));
        }
        
        // Handle single number
        return Math.max(0, Math.min(Number(input) || 0, totalTiles - 1));
    }

    public parseColorTrackType(Type: string, inputColor: string, inputBgColor: string): { color: string, bgcolor: string } {
        const trackColorX = this.formatHexColor(inputColor);
        const trackbgColorX = this.formatHexColor(inputBgColor);

        let intValue = { color: trackColorX, bgcolor: trackbgColorX };

        // Process colors based on track style (matches ADOFAI original logic)
        if (Type === "Standard" || Type === "Gems" || Type === "Basic" || Type === "Minimal") {
            // Standard/Gems: Darker version of main color for border
            intValue.bgcolor = this.processHexColor(trackColorX)[1];
            intValue.color = trackColorX;
        } else if (Type === "Neon") {
            // Neon: Black fill, colored border (glow effect)
            intValue.color = "#000000";
            intValue.bgcolor = trackColorX;
        } else if (Type === "NeonLight") {
            // NeonLight: Lighter border, colored fill
            intValue.color = this.processHexColor(trackColorX)[0];
            intValue.bgcolor = trackColorX;
        }

        return intValue;
    }

    /**
     * Core tile color renderer based on trackColorType
     * @param id Tile index
     * @param time Current time in seconds
     * @param rct Tile color configuration
     * @param amplitude Optional audio amplitude for Volume type
     * @param moveTrackOpacity Optional opacity from MoveTrack (0-1), multiplies with color alpha
     */
    public getTileRenderer(
        id: number, 
        time: number, 
        rct: TileColorConfig, 
        amplitude?: number,
        moveTrackOpacity: number = 1.0
    ): { color: string, bgcolor: string, alpha: number } {
        const {
            trackColorType, trackColor, secondaryTrackColor,
            trackColorPulse, trackColorAnimDuration, trackPulseLength,
            trackStyle,
            trackColorAlpha,
            secondaryTrackColorAlpha
        } = rct;

        // Debug: log trackStyle and trackColorType
        if (id === 0) {
            console.log(`[TileColorManager] Tile ${id}: trackStyle=${trackStyle}, trackColorType=${trackColorType}, trackColor=${trackColor}`);
        }

        let renderer_tileClientColor = { color: trackColor, bgcolor: secondaryTrackColor };
        let shouldDraw = 0;

        const isNeon = trackStyle === "Neon";
        const isNeonLight = trackStyle === "NeonLight";

        // Calculate pulse offset based on tile ID (matches ADOFAI logic)
        let pulseOffset = 0;
        if (trackColorPulse === "Forward") {
            pulseOffset = (1 - (id % trackPulseLength) / trackPulseLength) * trackColorAnimDuration;
        } else if (trackColorPulse === "Backward") {
            pulseOffset = ((id % trackPulseLength) / trackPulseLength) * trackColorAnimDuration;
        }

        // Get shadow color and alpha based on trackStyle (matches ADOFAI SetTrackStyle logic)
        // In ADOFAI, _ShadowColor is set to:
        // - Standard/Gems: Color.black.WithAlpha(0.45f)
        // - Neon/NeonLight: Color.white.WithAlpha(0.35f)
        // - Basic/Minimal: Color.clear (transparent)
        let shadowColor: string;
        let shadowAlpha: number;
        if (trackStyle === "Standard" || trackStyle === "Gems") {
            shadowColor = "#000000"; // Black shadow
            shadowAlpha = 0.45; // 0.45 alpha
        } else if (trackStyle === "Neon" || trackStyle === "NeonLight") {
            shadowColor = "#ffffff"; // White shadow
            shadowAlpha = 0.35; // 0.35 alpha
        } else {
            // Basic/Minimal: transparent shadow
            shadowColor = "#ffffff";
            shadowAlpha = 0.0; // Transparent
        }
        
        // Debug: log shadow color and alpha
        if (id === 0) {
            console.log(`[TileColorManager] Tile ${id}: shadowColor=${shadowColor}, shadowAlpha=${shadowAlpha}`);
        }
        
        const effectiveTime = time + pulseOffset;

        // A. Single - Solid color (matches ADOFAI ColorFloor: this.TweenColor(color1))
        if (trackColorType === "Single") {
            // ADOFAI: SetColor(color1) - floorRenderer.color = color1
            const formattedColor = this.formatHexColor(trackColor);
            
            // Shadow color based on trackStyle, floor color based on trackColorType
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = formattedColor;
            shouldDraw = 1;
        }

        // B. Stripes - Alternating colors (matches ADOFAI ColorFloor)
        else if (trackColorType === "Stripes") {
            // ADOFAI: TweenColor(color1 or color2) - floorRenderer.color = color1 or color2
            const useColor1 = (id % 2 === 0);
            const primaryColor = useColor1 ? trackColor : secondaryTrackColor;
            const formattedColor = this.formatHexColor(primaryColor);
            
            // Shadow color based on trackStyle, floor color based on trackColorType
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = formattedColor;
            shouldDraw = 1;
        }

        // C. Glow - Pulsing glow effect (matches ADOFAI ColorFloor: this.SetColor(Color.white); floorRenderer.color = color1)
        else if (trackColorType === "Glow") {
            // ADOFAI: SetColor(Color.white), floorRenderer.color = color1
            // Even though SetColor sets white shadow, this is overridden by trackStyle
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = this.formatHexColor(trackColor);
            shouldDraw = 1;
        }

        // D. Blink - On/off blinking (matches ADOFAI ColorFloor: this.SetColor(Color.white); floorRenderer.color = color1)
        else if (trackColorType === "Blink") {
            // ADOFAI: SetColor(Color.white), floorRenderer.color = color1
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = this.formatHexColor(trackColor);
            shouldDraw = 1;
        }

        // E. Switch - Switch between two colors (matches ADOFAI ColorFloor: this.SetColor(Color.white); floorRenderer.color = color1)
        else if (trackColorType === "Switch") {
            // ADOFAI: SetColor(Color.white), floorRenderer.color = color1
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = this.formatHexColor(trackColor);
            shouldDraw = 1;
        }

        // F. Rainbow - HSV rainbow animation (matches ADOFAI ColorFloor: this.SetColor(Color.white); floorRenderer.color = HSV(0, s, v))
        else if (trackColorType === "Rainbow") {
            // ADOFAI: SetColor(Color.white), floorRenderer.color = HSV(0, s, v)
            // Note: SetColor is called but trackStyle shadow color is used
            renderer_tileClientColor.color = "#ffffff";
            // floorRenderer.color is HSV with hue=0, saturation from color1, value from color1
            const formattedColor = this.formatHexColor(trackColor);
            const color = new THREE.Color(formattedColor);
            const hsl = {};
            color.getHSL(hsl);
            const rainbowColor = new THREE.Color().setHSL(0, hsl.s, hsl.l);
            renderer_tileClientColor.bgcolor = '#' + rainbowColor.getHexString();
            shouldDraw = 1;
        }

        // G. Volume - Volume-based color (matches ADOFAI ColorFloor: this.SetColor(Color.white); floorRenderer.color = color1)
        else if (trackColorType === "Volume") {
            // ADOFAI: SetColor(Color.white), floorRenderer.color = color1
            renderer_tileClientColor.color = shadowColor;
            renderer_tileClientColor.bgcolor = this.formatHexColor(trackColor);
            shouldDraw = 1;
        }

        // H. Default fallback
        if (shouldDraw === 0) {
            renderer_tileClientColor.color = trackColor;
            renderer_tileClientColor.bgcolor = trackColor;
            shouldDraw = 1;
        }

        // Calculate final alpha: combine color alpha with MoveTrack opacity
        // Multiply alpha values (0-1 range)
        let finalAlpha = trackColorAlpha * moveTrackOpacity;
        finalAlpha = Math.max(0, Math.min(1, finalAlpha));
        
        // IMPORTANT: Ensure minimum alpha of 0.1 to prevent completely invisible tiles
        // This prevents tiles from disappearing when alpha is 0
        finalAlpha = Math.max(0.1, finalAlpha);
        
        // Debug: log alpha calculation
        if (id === 0) {
            console.log(`[TileColorManager] Tile ${id} alpha calculation:`, {
                trackColorAlpha: trackColorAlpha,
                moveTrackOpacity: moveTrackOpacity,
                finalAlpha: finalAlpha
            });
        }

        return {
            color: renderer_tileClientColor.color,
            bgcolor: renderer_tileClientColor.bgcolor,
            alpha: finalAlpha,
            shadowAlpha: shadowAlpha
        };
    }

    /**
     * Interpolate between two colors using RGB space with gamma correction
     * This produces more vibrant results than HSL for glow effects
     */
    public genColor(c1: string, c2: string, t: number): string {
        const alpha = Math.max(0, Math.min(1, t));

        // Convert to RGB
        const color1 = new THREE.Color(c1);
        const color2 = new THREE.Color(c2);

        // Apply gamma correction for smoother blending
        const gamma = 2.2;
        const invGamma = 1.0 / gamma;

        const r1 = Math.pow(color1.r, gamma);
        const g1 = Math.pow(color1.g, gamma);
        const b1 = Math.pow(color1.b, gamma);

        const r2 = Math.pow(color2.r, gamma);
        const g2 = Math.pow(color2.g, gamma);
        const b2 = Math.pow(color2.b, gamma);

        // Linear interpolation
        const r = Math.pow(r1 + (r2 - r1) * alpha, invGamma);
        const g = Math.pow(g1 + (g2 - g1) * alpha, invGamma);
        const b = Math.pow(b1 + (b2 - b1) * alpha, invGamma);

        const result = new THREE.Color(r, g, b);
        return '#' + result.getHexString();
    }

    /**
     * Generate lighter and darker variants of a color for borders
     * Matches ADOFAI original color processing logic
     */
    public processHexColor(hex: string): [string, string] {
        let color = new THREE.Color(hex);

        // Generate lighter variant (for NeonLight borders)
        const lighter = new THREE.Color();
        lighter.copy(color);
        lighter.multiplyScalar(1.3); // 30% brighter
        lighter.r = Math.min(1, lighter.r);
        lighter.g = Math.min(1, lighter.g);
        lighter.b = Math.min(1, lighter.b);

        // Generate darker variant (for Standard borders)
        const darker = new THREE.Color();
        darker.copy(color);
        darker.multiplyScalar(0.5); // 50% darker

        return [
            '#' + lighter.getHexString(), // Lighter variant
            '#' + darker.getHexString()  // Darker variant
        ];
    }

    public formatHexColor(hex: string): string {
        if (!hex) return '#ffffff';

        // Remove '#' if present to normalize
        let cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;

        // Handle 8-digit hex (RRGGBBAA) by stripping alpha
        if (cleanHex.length === 8) {
            cleanHex = cleanHex.slice(0, 6);
        }

        // Ensure it's a valid hex string length (3 or 6)
        if (cleanHex.length !== 3 && cleanHex.length !== 6) {
            // Fallback to black if invalid
            return '#000000';
        }

        return '#' + cleanHex;
    }
}

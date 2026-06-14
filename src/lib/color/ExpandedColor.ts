import { Color } from 'three';

/**
 * Extended Color class that supports 8-digit hex colors (#RRGGBBAA).
 *
 * THREE.Color only handles 6-digit RGB. This class extracts and stores the
 * alpha channel separately, while passing the 6-digit RGB portion to the parent.
 *
 * The alpha is not applied automatically — callers must use it to set material
 * opacity or other alpha-aware properties.
 */
export class ExpandedColor extends Color {
  private _alpha: number = 1;

  /** Alpha channel, 0 (fully transparent) to 1 (fully opaque). */
  get alpha(): number {
    return this._alpha;
  }

  set alpha(value: number) {
    this._alpha = Math.max(0, Math.min(1, value));
  }

  constructor();
  constructor(color: ExpandedColor | Color | string | number);
  constructor(r: number, g: number, b: number);
  constructor(r?: any, g?: any, b?: any) {
    super();

    if (typeof r === 'string') {
      const hex = r.trim();
      if (hex.startsWith('#') && hex.length === 9) {
        this._alpha = parseInt(hex.slice(7, 9), 16) / 255;
        this.setStyle(hex.slice(0, 7));
      } else {
        this.setStyle(hex);
      }
    } else if (r instanceof Color) {
      this.copy(r);
    } else if (typeof r === 'number') {
      if (g === undefined && b === undefined) {
        if (r > 0xffffff) {
          this._alpha = ((r >> 24) & 0xff) / 255;
          this.setHex(r & 0xffffff);
        } else {
          this.setHex(r);
        }
      } else {
        this.r = r;
        this.g = g ?? 0;
        this.b = b ?? 0;
      }
    }
  }

  setHex(hex: number, colorSpace?: string): this {
    if (hex > 0xffffff) {
      this._alpha = ((hex >> 24) & 0xff) / 255;
      return super.setHex(hex & 0xffffff, colorSpace) as this;
    }
    this._alpha = 1;
    return super.setHex(hex, colorSpace) as this;
  }

  setStyle(style: string, colorSpace?: string): this {
    if (style.startsWith('#') && style.length === 9) {
      this._alpha = parseInt(style.slice(7, 9), 16) / 255;
      return super.setStyle(style.slice(0, 7), colorSpace) as this;
    }
    this._alpha = 1;
    return super.setStyle(style, colorSpace) as this;
  }

  /** Get the full 32-bit hex including alpha (0xRRGGBBAA). */
  getHexWithAlpha(): number {
    const rgb = this.getHex();
    return (Math.round(this._alpha * 255) << 24) | rgb;
  }

  /** Get the 9-character style string (#RRGGBBAA). */
  getStyleWithAlpha(): string {
    const hex = this.getHex().toString(16).padStart(6, '0');
    const a = Math.round(this._alpha * 255).toString(16).padStart(2, '0');
    return `#${hex}${a}`;
  }

  clone(): this {
    return new ExpandedColor(this.getHexWithAlpha()) as this;
  }
}

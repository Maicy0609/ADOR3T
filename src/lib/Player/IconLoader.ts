import { TextureLoader, Texture, SRGBColorSpace, RepeatWrapping, SpriteMaterial, Sprite } from 'three';

import endUrl from '@/assets/events/End.json';
import speedPlusUrl from '@/assets/events/Speed+.json';
import speedMinusUrl from '@/assets/events/Speed-.json';
import twirlB1Url from '@/assets/events/TwirlB1.json';
import twirlR1Url from '@/assets/events/TwirlR1.json';

const loader = new TextureLoader();

const texCache = new Map<string, Texture>();

function load(key: string, url: string): Texture {
    const tex = loader.load(url);
    tex.colorSpace = SRGBColorSpace;
    texCache.set(key, tex);
    return tex;
}

function loadFlipped(key: string, url: string): Texture {
    const tex = loader.load(url);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapT = RepeatWrapping;
    tex.repeat.y = -1;
    tex.offset.y = 1;
    texCache.set(key, tex);
    return tex;
}

const _e = () => load('End', endUrl);
const _sp = () => load('Speed+', speedPlusUrl);
const _sm = () => load('Speed-', speedMinusUrl);
const _tb1 = () => load('TwirlB1', twirlB1Url);
const _tb1n = () => loadFlipped('TwirlB-1', twirlB1Url);
const _tr1 = () => load('TwirlR1', twirlR1Url);
const _tr1n = () => loadFlipped('TwirlR-1', twirlR1Url);

export type IconType = 'End' | 'Speed+' | 'Speed-' | 'TwirlB1' | 'TwirlB-1' | 'TwirlR1' | 'TwirlR-1';

export function getIconTexture(type: IconType): Texture {
    switch (type) {
        case 'End': return _e();
        case 'Speed+': return _sp();
        case 'Speed-': return _sm();
        case 'TwirlB1': return _tb1();
        case 'TwirlB-1': return _tb1n();
        case 'TwirlR1': return _tr1();
        case 'TwirlR-1': return _tr1n();
    }
}

export function getTwirlTexture(angle: number, dir: number): IconType {
    const red = angle < 180;
    const d = dir >= 0 ? '1' : '-1';
    return red ? (`TwirlR${d}` as IconType) : (`TwirlB${d}` as IconType);
}

export function getSetSpeedTexture(ratio: number): IconType {
    return ratio > 1.05 ? 'Speed+' : 'Speed-';
}

export function getIconTextureForCustomFloor(trackIcon: string): IconType | null {
    switch (trackIcon) {
        case 'Swirl': return 'TwirlB1';
        case 'Rabbit':
        case 'DoubleRabbit': return 'Speed+';
        case 'Snail':
        case 'DoubleSnail': return 'Speed-';
        default: return null;
    }
}

export interface IconSpriteOptions {
    texture: Texture;
    opacity?: number;
    scale?: number;
}

export function createIconSprite(tex: Texture, opacity = 1, size = 0.22): Sprite {
    const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
    });
    const sprite = new Sprite(mat);
    sprite.scale.set(size, size, 1);
    sprite.center.set(0.5, 0.5);
    return sprite;
}

import * as THREE from 'three';

import endUrl from '@/assets/events/End.png';
import speedPlusUrl from '@/assets/events/Speed+.png';
import speedMinusUrl from '@/assets/events/Speed-.png';
import twirlB1Url from '@/assets/events/TwirlB1.png';
import twirlB1NegUrl from '@/assets/events/TwirlB-1.png';
import twirlR1Url from '@/assets/events/TwirlR1.png';
import twirlR1NegUrl from '@/assets/events/TwirlR-1.png';

const loader = new THREE.TextureLoader();

const texCache = new Map<string, THREE.Texture>();

function load(key: string, url: string): THREE.Texture {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, tex);
    return tex;
}

const _e = () => load('End', endUrl);
const _sp = () => load('Speed+', speedPlusUrl);
const _sm = () => load('Speed-', speedMinusUrl);
const _tb1 = () => load('TwirlB1', twirlB1Url);
const _tb1n = () => load('TwirlB-1', twirlB1NegUrl);
const _tr1 = () => load('TwirlR1', twirlR1Url);
const _tr1n = () => load('TwirlR-1', twirlR1NegUrl);

export type IconType = 'End' | 'Speed+' | 'Speed-' | 'TwirlB1' | 'TwirlB-1' | 'TwirlR1' | 'TwirlR-1';

export function getIconTexture(type: IconType): THREE.Texture {
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
    texture: THREE.Texture;
    opacity?: number;
    scale?: number;
}

export function createIconSprite(tex: THREE.Texture, opacity = 1, targetHeight = 0.22): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const img = tex.image;
    const aspect = img ? img.width / img.height : 1;
    sprite.scale.set(targetHeight * aspect, targetHeight, 1);
    sprite.center.set(0.5, 0.5);
    return sprite;
}

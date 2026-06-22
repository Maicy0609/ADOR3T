uniform sampler2D uTileTexture;
uniform float uTexScale;
uniform sampler2D uIconAtlas;
uniform float uIconAtlasCols;
uniform float uIconSize;

varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;
varying vec3 vWorldPosition;
varying float vTexSeed;
varying float vFloorIconType;
varying vec2 vTileCenter;

void main() {
    vec3 finalColor = mix(vInstanceBgColor, vInstanceColor, vColor.r);

    if (vTexSeed > 0.0) {
        vec2 uv = vWorldPosition.xy * uTexScale;
        float angle = vTexSeed * 6.2832;
        float c = cos(angle);
        float s = sin(angle);
        uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        uv += vec2(vTexSeed * 3.7, vTexSeed * 1.3);
        vec4 texColor = texture2D(uTileTexture, uv);
        finalColor *= texColor.rgb;
    }

    // Floor icon overlay — tile-center-relative UV, no area restriction
    if (vFloorIconType > 0.5 && uIconSize > 0.0) {
        vec2 iconUv = (vWorldPosition.xy - vTileCenter) / uIconSize + 0.5;
        iconUv.x = iconUv.x / uIconAtlasCols + (vFloorIconType - 1.0) / uIconAtlasCols;
        vec4 iconColor = texture2D(uIconAtlas, iconUv);
        if (iconColor.a > 0.1) {
            finalColor = mix(finalColor, iconColor.rgb, iconColor.a);
        }
    }

    gl_FragColor = vec4(finalColor, vOpacity);
}

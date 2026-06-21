uniform sampler2D uTileTexture;
uniform float uTexScale;

varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;
varying vec3 vWorldPosition;
varying float vTexSeed;

void main() {
    // Discard fully transparent fragments so they don't occlude tiles behind
    if (vOpacity < 0.001) discard;

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

    gl_FragColor = vec4(finalColor, vOpacity);
}

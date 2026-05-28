attribute vec3 iColor;
attribute vec3 iBgColor;
attribute float iOpacity;
attribute float iTexSeed;

varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;
varying vec3 vWorldPosition;
varying float vTexSeed;

void main() {
    vColor = color;
    vInstanceColor = iColor;
    vInstanceBgColor = iBgColor;
    vOpacity = iOpacity;
    vTexSeed = iTexSeed;

    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}

attribute vec3 iColor;
attribute vec3 iBgColor;
attribute float iOpacity;
attribute float iTexSeed;
attribute float iFloorIconType;

varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;
varying vec3 vWorldPosition;
varying float vTexSeed;
varying float vFloorIconType;
varying vec3 vTileCenter;

void main() {
    vColor = color;
    vInstanceColor = iColor;
    vInstanceBgColor = iBgColor;
    vOpacity = iOpacity;
    vTexSeed = iTexSeed;
    vFloorIconType = iFloorIconType;

    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vTileCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}

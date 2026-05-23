attribute vec3 iColor;
attribute vec3 iBgColor;
attribute float iOpacity;

varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;

void main() {
    vColor = color;
    vInstanceColor = iColor;
    vInstanceBgColor = iBgColor;
    vOpacity = iOpacity;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}

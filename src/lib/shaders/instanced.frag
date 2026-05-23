varying vec3 vColor;
varying vec3 vInstanceColor;
varying vec3 vInstanceBgColor;
varying float vOpacity;

void main() {
    vec3 finalColor = mix(vInstanceBgColor, vInstanceColor, vColor.r);
    gl_FragColor = vec4(finalColor, vOpacity);
}

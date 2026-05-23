uniform sampler2D tDiffuse;
uniform float threshold;
varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    float brightness = max(max(color.r, color.g), color.b);

    if (brightness < threshold) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        gl_FragColor = color;
    }
}

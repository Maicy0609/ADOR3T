uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float intensity;
uniform vec3 bloomColor;
varying vec2 vUv;

void main() {
    vec4 original = texture2D(tDiffuse, vUv);
    vec4 bloom = texture2D(tBloom, vUv);

    vec3 tintedBloom = bloom.rgb * bloomColor;

    vec3 result = original.rgb + tintedBloom * intensity;

    gl_FragColor = vec4(result, 1.0);
    #include <colorspace_fragment>
}

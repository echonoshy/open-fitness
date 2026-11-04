// Display-only compositor. Pose inference always consumes the original image.
// Input image and mask MUST come from the same inference frame.
import type { MPMask } from "@mediapipe/tasks-vision";

const vertex = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0, 1);
}`;
const blur = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D image;
uniform vec2 stepSize;
uniform bool flip;
void main() {
  vec2 p = flip ? vec2(uv.x, 1.0 - uv.y) : uv;
  vec4 c = vec4(0); float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float weight = exp(-float(i*i)/12.5);
    c += texture(image, p + stepSize * float(i)) * weight;
    total += weight;
  }
  color = c / total;
}`;
const downsample = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D image;
uniform vec2 sourceStep;
void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y); vec4 c = vec4(0);
  for (int y=0;y<4;y++) for (int x=0;x<4;x++)
    c += texture(image, p + (vec2(x,y)-1.5)*sourceStep);
  color = c / 16.0;
}`;
const combine = `#version 300 es
precision highp float;
in vec2 uv; out vec4 color;
uniform sampler2D image;
uniform sampler2D background;
uniform sampler2D mask;
uniform vec2 maskStep;
uniform bool hasMask;
void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  float a = 0.0;
  if (hasMask) {
    a = texture(mask, p).r * 0.5;
    a += texture(mask, p + vec2(maskStep.x,0)).r * 0.125;
    a += texture(mask, p - vec2(maskStep.x,0)).r * 0.125;
    a += texture(mask, p + vec2(0,maskStep.y)).r * 0.125;
    a += texture(mask, p - vec2(0,maskStep.y)).r * 0.125;
    a = smoothstep(0.25, 0.75, a);
  }
  color = vec4(mix(texture(background,uv).rgb, texture(image,p).rgb,a),1);
}`;

export class BlurCompositor {
  readonly canvas = new OffscreenCanvas(1, 1);
  readonly gl: WebGL2RenderingContext;
  private blurProgram: WebGLProgram;
  private combineProgram: WebGLProgram;
  private downsampleProgram: WebGLProgram;
  private textures: WebGLTexture[];
  private buffers: WebGLFramebuffer[];
  private width = 0;
  private height = 0;
  private maskBytes = new Uint8Array(1);
  constructor() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw Error("背景虚化无法创建 WebGL2 上下文");
    this.gl = gl;
    this.blurProgram = this.program(blur);
    this.combineProgram = this.program(combine);
    this.downsampleProgram = this.program(downsample);
    this.textures = Array.from({ length: 4 }, () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });
    this.buffers = [gl.createFramebuffer()!, gl.createFramebuffer()!];
  }
  private program(fragment: string) {
    const gl = this.gl;
    const shaders = [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ].map(([type, code]) => {
      const s = gl.createShader(type as number)!;
      gl.shaderSource(s, code as string);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s)!);
      return s;
    });
    const p = gl.createProgram()!;
    for (const s of shaders) gl.attachShader(p, s);
    gl.linkProgram(p);
    for (const s of shaders) gl.deleteShader(s);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw Error(gl.getProgramInfoLog(p)!);
    return p;
  }
  private bind(unit: number, texture: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }
  render(source: ImageBitmap, mask?: MPMask): ImageBitmap {
    const gl = this.gl;
    if (gl.isContextLost()) throw Error("背景虚化图形上下文已中断");
    const w = source.width,
      h = source.height;
    const bw = Math.max(1, Math.round(w / 4)),
      bh = Math.max(1, Math.round(h / 4));
    if (w !== this.width || h !== this.height) {
      this.width = this.canvas.width = w;
      this.height = this.canvas.height = h;
      for (let i = 0; i < 2; i++) {
        this.bind(0, this.textures[i + 2]);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          bw,
          bh,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[i]);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          this.textures[i + 2],
          0,
        );
        if (
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw Error("背景虚化帧缓冲不可用");
      }
    }
    this.bind(0, this.textures[0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    // R8 avoids float-texture filtering differences between drivers. Conversion
    // happens only in this experimental worker; original landmarks are untouched.
    this.bind(1, this.textures[1]);
    const values = mask?.getAsFloat32Array();
    if (this.maskBytes.length !== (values?.length ?? 1))
      this.maskBytes = new Uint8Array(values?.length ?? 1);
    const bytes = this.maskBytes;
    if (values)
      for (let i = 0; i < values.length; i++) bytes[i] = values[i] * 255 + 0.5;
    else bytes[0] = 0;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      mask?.width ?? 1,
      mask?.height ?? 1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    gl.viewport(0, 0, bw, bh);
    // Prefilter before reducing resolution; sparse sampling of the full-size
    // source otherwise leaves duplicated rails/shelves in the blurred background.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[0]);
    gl.useProgram(this.downsampleProgram);
    this.bind(0, this.textures[0]);
    gl.uniform1i(gl.getUniformLocation(this.downsampleProgram, "image"), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.downsampleProgram, "sourceStep"),
      1 / w,
      1 / h,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blurProgram);
    gl.uniform1i(gl.getUniformLocation(this.blurProgram, "image"), 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.buffers[i === 0 ? 1 : 0]);
      this.bind(0, this.textures[i === 0 ? 2 : 3]);
      gl.uniform1i(gl.getUniformLocation(this.blurProgram, "flip"), 0);
      gl.uniform2f(
        gl.getUniformLocation(this.blurProgram, "stepSize"),
        i === 0 ? 1 / bw : 0,
        i === 1 ? 1 / bh : 0,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.combineProgram);
    this.bind(0, this.textures[0]);
    this.bind(1, this.textures[1]);
    this.bind(2, this.textures[2]);
    gl.uniform1i(gl.getUniformLocation(this.combineProgram, "image"), 0);
    gl.uniform1i(gl.getUniformLocation(this.combineProgram, "mask"), 1);
    gl.uniform1i(gl.getUniformLocation(this.combineProgram, "background"), 2);
    gl.uniform1i(
      gl.getUniformLocation(this.combineProgram, "hasMask"),
      mask ? 1 : 0,
    );
    gl.uniform2f(
      gl.getUniformLocation(this.combineProgram, "maskStep"),
      1 / w,
      1 / h,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas.transferToImageBitmap();
  }
  close() {
    const gl = this.gl;
    for (const t of this.textures) gl.deleteTexture(t);
    for (const b of this.buffers) gl.deleteFramebuffer(b);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.combineProgram);
    gl.deleteProgram(this.downsampleProgram);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

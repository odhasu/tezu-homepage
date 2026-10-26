import type { TezuMotionItem } from "./motion-gallery-media";

export type GalleryMotion = "lens" | "reel" | "fold" | "arc";

type TextureMedia = {
  item: TezuMotionItem;
  texture: WebGLTexture;
  image: HTMLImageElement;
  video: HTMLVideoElement | null;
  loaded: boolean;
  uploadedAt: number;
};

const vertexSource = `
precision highp float;
attribute vec2 aPosition;
attribute vec2 aUv;
uniform vec2 uViewport;
uniform vec2 uSize;
uniform float uOffset;
uniform float uMode;
uniform float uAngle;
uniform vec2 uCenter;
uniform float uScale;
varying vec2 vUv;
varying float vLight;
void main() {
  vec2 p = aPosition * uSize;
  vUv = aUv;
  vLight = 1.0;
  if (uMode < 0.5) {
    p.y += uOffset;
    float edge = max(0.0, abs(p.y) / (uViewport.y * 0.5) - 0.42) / 0.58;
    p.x *= 1.0 + 2.9 * edge * edge;
    p.y += sign(p.y) * edge * edge * edge * 14.0;
    vLight = 1.0 - min(edge * 0.22, 0.3);
  } else if (uMode < 1.5) {
    p.x += uOffset;
    float edge = abs(p.x) / (uViewport.x * 0.5);
    p.y *= 0.56 + 1.05 * pow(edge, 2.4);
    vLight = 0.95 - min(edge * 0.08, 0.2);
  } else if (uMode < 2.5) {
    p.x += uOffset;
    float crease = exp(-pow(p.x / min(uViewport.x * 0.18, 116.0), 2.0));
    p.x *= 1.0 - crease * 0.28;
    p.y *= 1.0 + crease * 0.56;
    p.y += sin(p.x / uViewport.x * 2.0) * 10.0;
    vLight = 1.0 - crease * 0.24 + exp(-pow(p.x / 5.0, 2.0)) * 0.2;
  } else {
    p *= uScale;
    p = mat2(cos(uAngle), sin(uAngle), -sin(uAngle), cos(uAngle)) * p;
    p += uCenter;
  }
  gl_Position = vec4(p.x / uViewport.x * 2.0, -p.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uSize;
uniform float uOpacity;
varying vec2 vUv;
varying float vLight;
void main() {
  vec2 q = abs((vUv - 0.5) * uSize) - uSize * 0.5 + 8.0;
  float distance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 8.0;
  float edge = 1.0 - smoothstep(-0.65, 0.65, distance);
  vec4 color = texture2D(uTexture, vUv);
  gl_FragColor = vec4(color.rgb * vLight * 0.94, color.a * edge * uOpacity);
}`;

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("Could not create gallery shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    gl.deleteShader(result);
    throw new Error("Gallery shader is unavailable");
  }
  return result;
}

/** A tessellated media surface: the deformation follows the viewport, not each card. */
export class MotionGalleryEngine {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly media: TextureMedia[];
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly observer: ResizeObserver;
  private readonly vertices: number;
  private frame = 0;
  private width = 1;
  private height = 1;
  private position = 0;
  private target = 0;
  private lastTime = 0;
  private index = -1;
  private visible = false;
  private paused = false;
  private dragging = false;
  private disposed = false;
  private ready = false;
  private spacing = 180;
  private radius = 300;
  private readonly drawFrame = (time: number) => this.draw(time);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mode: GalleryMotion,
    items: TezuMotionItem[],
    private readonly reducedMotion: boolean,
    private readonly onIndex: (index: number) => void,
    private readonly onReady: () => void,
  ) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL is unavailable");
    this.gl = gl;
    const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create gallery renderer");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Gallery renderer is unavailable");
    this.program = program;
    gl.useProgram(program);
    this.uniforms = Object.fromEntries(["uViewport", "uSize", "uOffset", "uMode", "uAngle", "uCenter", "uScale", "uTexture", "uOpacity"].map(name => [name, gl.getUniformLocation(program, name)]));
    const points: number[] = [];
    const columns = 32;
    const rows = 32;
    const add = (x: number, y: number) => points.push(x / columns - .5, y / rows - .5, x / columns, 1 - y / rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        add(x, y); add(x + 1, y); add(x, y + 1);
        add(x, y + 1); add(x + 1, y); add(x + 1, y + 1);
      }
    }
    this.vertices = points.length / 4;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not create gallery geometry");
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    const uv = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(this.uniforms.uTexture, 0);
    gl.uniform1f(this.uniforms.uMode, ["lens", "reel", "fold", "arc"].indexOf(mode));
    this.media = items.map(item => {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not create gallery media");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([28, 28, 28, 255]));
      const image = new Image();
      const entry: TextureMedia = { item, texture, image, video: null, loaded: false, uploadedAt: 0 };
      image.onload = () => {
        if (this.disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        entry.loaded = true;
        this.wake();
      };
      image.src = item.poster;
      return entry;
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  private resize() {
    this.width = this.canvas.clientWidth || 1;
    this.height = this.canvas.clientHeight || 1;
    const density = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * density);
    this.canvas.height = Math.round(this.height * density);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.radius = this.width < 500 ? this.width * .78 : this.width * .56;
    this.spacing = this.mode === "lens" ? this.height * .28 : this.mode === "arc" ? this.radius * .4 : Math.min(this.width * .32, 190);
    this.wake();
  }

  private wake() {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.drawFrame);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.lastTime = 0;
    if (!visible) this.media.forEach(entry => entry.video?.pause());
    this.wake();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.media.forEach(entry => entry.video?.pause());
    this.wake();
  }

  step(direction: number) {
    this.target = Math.round(this.target) + direction;
    if (this.reducedMotion) this.position = this.target;
    this.wake();
  }

  moveTo(index: number) {
    this.target += index - this.activeIndex();
    if (this.reducedMotion) this.position = this.target;
    this.wake();
  }

  beginDrag() { this.dragging = true; }
  drag(pixels: number) { this.target -= pixels / this.spacing; if (this.reducedMotion) this.position = this.target; this.wake(); }
  endDrag(velocity: number) { this.dragging = false; if (!this.reducedMotion) this.target -= Math.max(-2, Math.min(2, velocity * 140 / this.spacing)); this.wake(); }
  scroll(pixels: number) { if (this.reducedMotion) return; this.target += Math.max(-.35, Math.min(.35, pixels / 900)); this.wake(); }
  activeIndex() { return ((Math.round(this.position) % this.media.length) + this.media.length) % this.media.length; }

  pick(x: number, y: number): TezuMotionItem | null {
    const position = this.mode === "lens" ? y - this.height / 2 : x - this.width / 2;
    if (this.mode === "arc") {
      const angle = Math.asin(Math.max(-.98, Math.min(.98, position / this.radius)));
      const offset = Math.round(angle / .4);
      if (offset !== 0) { this.target = Math.round(this.position) + offset; this.wake(); return null; }
    } else {
      const offset = Math.round(position / this.spacing);
      if (offset !== 0) { this.target = Math.round(this.position) + offset; this.wake(); return null; }
    }
    return this.media[this.activeIndex()].item;
  }

  private updateVideo(entry: TextureMedia, playing: boolean, time: number) {
    if (playing && !entry.video && entry.item.kind === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = entry.item.src;
      entry.video = video;
    }
    const video = entry.video;
    if (!video) return;
    if (playing && video.paused) void video.play().catch(() => {});
    if (!playing && !video.paused) video.pause();
    if (video.readyState >= 2 && time - entry.uploadedAt > 40 && (playing || !entry.loaded)) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, entry.texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, video);
      entry.loaded = true;
      entry.uploadedAt = time;
    }
  }

  private draw(time: number) {
    this.frame = 0;
    if (this.disposed) return;
    const elapsed = this.lastTime ? Math.min((time - this.lastTime) / 1000, .05) : 0;
    this.lastTime = time;
    const auto = this.visible && !this.paused && !this.reducedMotion && !this.dragging;
    if (auto) this.target += elapsed * (this.mode === "arc" ? .12 : .23);
    this.position += (this.target - this.position) * (1 - Math.exp(-elapsed * 11));
    const active = this.activeIndex();
    if (active !== this.index) { this.index = active; this.onIndex(active); }
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uniforms.uViewport, this.width, this.height);
    const cycle = this.media.length;
    let anyReady = false;
    this.media.forEach((entry, i) => {
      const delta = ((i - this.position + cycle * 1000 + cycle / 2) % cycle) - cycle / 2;
      const inFrame = this.mode === "lens" ? Math.abs(delta * this.spacing) < this.height * .8 : this.mode === "arc" ? Math.abs(delta) < 4.5 : Math.abs(delta * this.spacing) < this.width * .75;
      const playing = inFrame && Math.abs(delta) < .8 && auto;
      this.updateVideo(entry, playing, time);
      if (!inFrame) return;
      const ratio = entry.item.width / entry.item.height;
      let height = this.mode === "lens" ? this.spacing - 12 : this.mode === "arc" ? this.height * .47 : this.mode === "reel" ? this.height * .96 : this.height * .58;
      let width = height * ratio;
      if (this.mode !== "lens" && this.mode !== "arc" && width > this.spacing - 9) { width = this.spacing - 9; height = width / ratio; }
      gl.uniform2f(this.uniforms.uSize, width, height);
      gl.uniform1f(this.uniforms.uOffset, delta * this.spacing);
      gl.uniform1f(this.uniforms.uOpacity, entry.loaded ? 1 : .25);
      const angle = delta * .4;
      gl.uniform1f(this.uniforms.uAngle, angle);
      gl.uniform2f(this.uniforms.uCenter, Math.sin(angle) * this.radius, -this.height * .12 + this.radius * (1 - Math.cos(angle)));
      gl.uniform1f(this.uniforms.uScale, .74 + .26 * Math.exp(-delta * delta * 4));
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertices);
      anyReady ||= entry.loaded;
    });
    if (anyReady && !this.ready) { this.ready = true; this.onReady(); }
    if (this.visible && (auto || Math.abs(this.target - this.position) > .001)) this.wake();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.media.forEach(entry => {
      entry.image.onload = null;
      if (entry.video) { entry.video.pause(); entry.video.removeAttribute("src"); entry.video.load(); }
      this.gl.deleteTexture(entry.texture);
    });
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}

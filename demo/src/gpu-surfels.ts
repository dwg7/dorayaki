/**
 * GPU resources for splats: shader program, buffer upload, draw call.
 *
 * Deliberately simple: one instanced quad per splat. A splat with a
 * preferred orientation is drawn as its 2-sigma ellipse, in the plane of
 * its two longer axes (the quad's corners are `centre ± axisU ± axisV`
 * and fragments outside the unit circle are discarded). A splat with no
 * preferred orientation ("round") is drawn as a camera-facing disc.
 * Two-sided Lambert shading from a fixed light: the sign of a splat's axis
 * carries no meaning. No knowledge of MapLibre or of the wire format; input
 * is decoded Splat objects (see splat-instances.ts).
 */
import type { Splat } from "../../src/surfel-block.js";
import { classPaletteArray } from "./class-palette.js";
import { cameraAxes, splatInstances, type SplatInstances } from "./splat-instances.js";

/**
 * Color grade of the stored splat colors, before shading (`?vivid=`, E023): brightness, contrast around mid gray, then
 * saturation, in the order of the CSS filters used to find the values. `u_vivid` 0 leaves the colors as stored; 1 is
 * brightness 1.35, contrast 1.2, saturation 1.6; the three move linearly with it. The point cloud's colors are dark
 * (mean RGB about 70 of 255 in Kawazu), so the render looks dull without it.
 */
const GRADE_GLSL = `uniform float u_vivid;      // 0: the colors as stored; 1: brightness 1.35, contrast 1.2, saturation 1.6
vec3 grade(vec3 c) {
  c *= 1.0 + 0.35 * u_vivid;
  c = (c - 0.5) * (1.0 + 0.2 * u_vivid) + 0.5;
  float l = dot(c, vec3(0.213, 0.715, 0.072));
  return clamp(mix(vec3(l), c, 1.0 + 0.6 * u_vivid), 0.0, 1.0);
}`;

/**
 * Deterministic per-splat irregularity (`?jitter=`, E024): on a regular voxel grid, equal discs in a diagonal lattice look
 * mechanical. A hash of the instance index moves each splat inside its own plane by up to `u_jitter / 2` of its semi-axes
 * and enlarges it by up to `u_jitter / 2`; it never shrinks one, so no gap opens. 0 draws the splats as stored. The same
 * index gives the same offsets in every pass and every frame.
 */
const JITTER_GLSL = `uniform float u_jitter;     // 0: the splats as stored; 1: up to half a semi-axis of shift and 50 % of growth
vec3 jitterHash(uint n) {
  n = (n ^ 61u) ^ (n >> 16u);
  n *= 9u;
  n ^= n >> 4u;
  n *= 0x27d4eb2du;
  n ^= n >> 15u;
  uint m = n * 747796405u + 2891336453u;
  m = ((m >> ((m >> 28u) + 4u)) ^ m) * 277803737u;
  return vec3(float(n & 1023u), float((n >> 10u) & 1023u), float(m & 1023u)) / 1023.0;
}`;

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;      // local metric frame (metres; east, south, up) -> clip
uniform float u_tile_width; // metres per tile-local unit
uniform float u_min_radius; // metres; semi-axis floor when drawing a progressive prefix
uniform float u_extent;     // factor on every semi-axis (1 = the 2-sigma ellipse); covers gaps between neighbours
uniform vec3 u_light;       // local metric frame, normalized
uniform vec3 u_right;       // camera right in the local metric frame, normalized
uniform vec3 u_up;
uniform float u_shade;      // 1: the fixed two-sided Lambert shading; 0: the colors as stored (no shading)
${GRADE_GLSL}
${JITTER_GLSL}
uniform uvec4 u_hide_mask;  // bit c of the 128 bits: skip the splats of class code c (E021)
uniform float u_has_class;  // 1: the tile has class codes (a_class)
uniform float u_class_color; // 1: color by class instead of the stored color
uniform vec3 u_palette[128]; // color of class code c (class-palette.ts)
bool hidden(float cls) {
  uint code = uint(cls + 0.5);
  return u_has_class > 0.5 && code < 128u && ((u_hide_mask[code >> 5u] >> (code & 31u)) & 1u) == 1u;
}          // camera up in the local metric frame, normalized
in vec2 a_corner;           // quad corner in [-1, 1]^2
in float a_class;           // class code of the splat (u_has_class says whether the tile has them)
in vec3 a_position;         // x, y tile-local; z metres
in vec3 a_axis_u;           // semi-axis vector along the major axis, metres
in vec3 a_axis_v;           // semi-axis vector along the minor axis, metres
in vec3 a_normal;           // shortest axis
in float a_round;           // 1: camera-facing disc of radius |a_axis_u|
in vec4 a_color;
out vec2 v_corner;
out vec3 v_color;
void main() {
  if (hidden(a_class)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 centre = vec3(a_position.xy * u_tile_width, a_position.z);
  vec3 u = a_axis_u;
  vec3 v = a_axis_v;
  float shade;
  if (a_round > 0.5) {
    float r = max(length(a_axis_u) * u_extent, u_min_radius);
    u = u_right * r;
    v = u_up * r;
    shade = mix(1.0, 0.8, u_shade);
  } else {
    float lu = max(length(u), 1e-9);
    float lv = max(length(v), 1e-9);
    u *= u_extent * max(1.0, u_min_radius / (lu * u_extent));
    v *= u_extent * max(1.0, u_min_radius / (lv * u_extent));
    shade = mix(1.0, 0.35 + 0.65 * abs(dot(normalize(a_normal), u_light)), u_shade);
  }
  vec3 jh = jitterHash(uint(gl_InstanceID));
  centre += (u * (jh.x - 0.5) + v * (jh.y - 0.5)) * u_jitter;
  float jgrow = 1.0 + u_jitter * 0.5 * jh.z;
  u *= jgrow;
  v *= jgrow;
  vec3 p = centre + a_corner.x * u + a_corner.y * v;
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
  vec3 base = (u_class_color > 0.5 && u_has_class > 0.5) ? u_palette[min(uint(a_class + 0.5), 127u)] : a_color.rgb;
  bool byClass = u_class_color > 0.5 && u_has_class > 0.5;
  v_color = (byClass ? base : grade(base)) * shade;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_color;
uniform float u_soft;       // 1: Gaussian-feathered, blended pass (the soft look); 0: opaque
uniform float u_falloff;    // exponent of the Gaussian falloff over the quad (soft pass)
out vec4 fragColor;
void main() {
  float r2 = dot(v_corner, v_corner);
  if (r2 > 1.0) discard;
  if (u_soft > 0.5) {
    // Gaussian weight of the distance from the centre (r2 = 1 at the quad's edge), premultiplied.
    float a = 0.95 * exp(-u_falloff * r2);
    if (a < 0.02) discard;
    fragColor = vec4(v_color * a, a);
  } else {
    fragColor = vec4(v_color, 1.0); // opaque, so already premultiplied
  }
}`;

/**
 * Vertex shader that decodes packed records. `bytes` 16: the record of versions 4 and 5; 12: the bit-packed record of
 * version 6 (V6_FIELDS in src/surfel-block.ts, `u_scale_base` the block's scaleLog2Min). The decoding mirrors
 * splat-instances.ts for the drawing and the codec for the fields.
 */
function packedVertexShader(bytes: 16 | 12): string {
  const v6 = bytes === 12;
  const record = v6
    ? `in uvec3 a_rec;             // the 12-byte record as three little-endian words
uniform float u_scale_base; // log2 of the metres of scale code 0
// \`len\` bits (at most 25) at bit \`off\` of the 96-bit record.
uint bits(uint off, uint len) {
  uint w = off >> 5u;
  uint o = off & 31u;
  uint lo = a_rec[w] >> o;
  uint hi = (o + len > 32u) ? (a_rec[w + 1u] << (32u - o)) : 0u;
  return (lo | hi) & ((1u << len) - 1u);
}`
    : "in uvec4 a_rec;             // the 16-byte record as four little-endian words";
  const decode = v6
    ? `  vec3 pos = vec3(float(bits(0u, 13u)) / 8192.0, float(bits(13u, 13u)) / 8192.0, u_z_origin + float(bits(26u, 14u)) * u_z_step);
  uint codes[3] = uint[3](bits(40u, 7u), bits(47u, 7u), bits(54u, 7u));
  float sc[3];
  for (int i = 0; i < 3; i++) sc[i] = exp2(u_scale_base + float(codes[i]) / 6.0);
  uint qb = bits(61u, 17u);
  const uint QBITS = 5u;
  const uint QMASK = 31u;
  const float QHALF = 15.0;
  vec3 rgb = vec3(float(bits(78u, 6u)), float(bits(84u, 6u)), float(bits(90u, 6u))) / 63.0;`
    : `  uint w0 = a_rec.x, w1 = a_rec.y, w2 = a_rec.z, w3 = a_rec.w;
  vec3 pos = vec3(float(w0 & 0xFFFFu) / 65536.0, float(w0 >> 16) / 65536.0, u_z_origin + float(w1 & 0xFFFFu) * u_z_step);
  uint codes[3] = uint[3](w1 >> 16 & 255u, w1 >> 24, w2 & 255u);
  float sc[3];
  for (int i = 0; i < 3; i++) sc[i] = exp2(float(codes[i]) / 10.0 - 16.0);
  uint qb = (w2 >> 8) & 0xFFFFFFu;
  const uint QBITS = 7u;
  const uint QMASK = 127u;
  const float QHALF = 63.0;
  vec3 rgb = vec3(float(w3 & 255u), float((w3 >> 8) & 255u), float((w3 >> 16) & 255u)) / 255.0;`;
  // A splat is round when its largest and smallest scale codes differ by less than a ratio of 1.5:
  // 10 steps per octave (versions 4, 5): at most 5 codes; 6 steps per octave (version 6): at most 3.
  const roundDiff = v6 ? "3u" : "5u";
  return `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_matrix;
uniform float u_tile_width;
uniform float u_min_radius;
uniform float u_extent;
uniform vec3 u_light;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_shade;      // 1: the fixed two-sided Lambert shading; 0: the colors as stored (no shading)
${GRADE_GLSL}
${JITTER_GLSL}
uniform uvec4 u_hide_mask;  // bit c of the 128 bits: skip the splats of class code c (E021)
uniform float u_has_class;  // 1: the tile has class codes (a_class)
uniform float u_class_color; // 1: color by class instead of the stored color
uniform vec3 u_palette[128]; // color of class code c (class-palette.ts)
bool hidden(float cls) {
  uint code = uint(cls + 0.5);
  return u_has_class > 0.5 && code < 128u && ((u_hide_mask[code >> 5u] >> (code & 31u)) & 1u) == 1u;
}
uniform float u_z_origin;   // metres, of the tile's block
uniform float u_z_step;     // metres per z code
in vec2 a_corner;
in float a_class;           // class code of the splat (u_has_class says whether the tile has them)
${record}
out vec2 v_corner;
out vec3 v_color;
const float QUAT_RANGE = 0.70710678118654752;
void main() {
  if (hidden(a_class)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
${decode}
  // Rotation: columns of the matrix of the unit quaternion (w, x, y, z).
  int largest = int(qb & 3u);
  float q[4];
  float sumSq = 0.0;
  uint shift = 2u;
  for (int i = 0; i < 4; i++) {
    if (i == largest) { q[i] = 0.0; continue; }
    float v = (float((qb >> shift) & QMASK) - QHALF) / QHALF * QUAT_RANGE;
    q[i] = v;
    sumSq += v * v;
    shift += QBITS;
  }
  q[largest] = sqrt(max(0.0, 1.0 - sumSq));
  float inv = 1.0 / length(vec4(q[0], q[1], q[2], q[3]));
  float qw = q[0] * inv, qx = q[1] * inv, qy = q[2] * inv, qz = q[3] * inv;
  vec3 axes[3];
  axes[0] = vec3(1.0 - 2.0 * (qy * qy + qz * qz), 2.0 * (qx * qy + qw * qz), 2.0 * (qx * qz - qw * qy));
  axes[1] = vec3(2.0 * (qx * qy - qw * qz), 1.0 - 2.0 * (qx * qx + qz * qz), 2.0 * (qy * qz + qw * qx));
  axes[2] = vec3(2.0 * (qx * qz + qw * qy), 2.0 * (qy * qz - qw * qx), 1.0 - 2.0 * (qx * qx + qy * qy));
  // Rank of each axis by scale code, shortest first; ties keep index order.
  int rank[3];
  rank[0] = int(codes[1] < codes[0]) + int(codes[2] < codes[0]);
  rank[1] = int(codes[0] <= codes[1]) + int(codes[2] < codes[1]);
  rank[2] = int(codes[0] <= codes[2]) + int(codes[1] <= codes[2]);
  vec3 an, aa, ab;
  float sa = 0.0, sb = 0.0;
  for (int i = 0; i < 3; i++) {
    if (rank[i] == 0) an = axes[i];
    else if (rank[i] == 1) { aa = axes[i]; sa = sc[i]; }
    else { ab = axes[i]; sb = sc[i]; }
  }
  uint cmin = min(codes[0], min(codes[1], codes[2]));
  uint cmax = max(codes[0], max(codes[1], codes[2]));
  vec3 centre = vec3(pos.xy * u_tile_width, pos.z);
  vec3 u, v;
  float shade;
  if (cmax - cmin <= ${roundDiff}) {
    float r = max(2.0 * sqrt(sa * sb) * u_extent, u_min_radius);
    u = u_right * r;
    v = u_up * r;
    shade = mix(1.0, 0.8, u_shade);
  } else {
    u = aa * 2.0 * sa;
    v = ab * 2.0 * sb;
    float lu = max(length(u), 1e-9);
    float lv = max(length(v), 1e-9);
    u *= u_extent * max(1.0, u_min_radius / (lu * u_extent));
    v *= u_extent * max(1.0, u_min_radius / (lv * u_extent));
    shade = mix(1.0, 0.35 + 0.65 * abs(dot(normalize(an), u_light)), u_shade);
  }
  vec3 jh = jitterHash(uint(gl_InstanceID));
  centre += (u * (jh.x - 0.5) + v * (jh.y - 0.5)) * u_jitter;
  float jgrow = 1.0 + u_jitter * 0.5 * jh.z;
  u *= jgrow;
  v *= jgrow;
  vec3 p = centre + a_corner.x * u + a_corner.y * v;
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
  vec3 base = (u_class_color > 0.5 && u_has_class > 0.5) ? u_palette[min(uint(a_class + 0.5), 127u)] : rgb;
  bool byClass = u_class_color > 0.5 && u_has_class > 0.5;
  v_color = (byClass ? base : grade(base)) * shade;
}`;
}

/** Light direction in the local metric frame (east, south, up): from the north-west, above. */
const PALETTE = classPaletteArray();
const NO_HIDDEN_CLASSES = new Uint32Array(4);

/** The 128-bit mask of class codes to skip, as four uint32 words (codes outside 0..127 are ignored). */
export function hideMaskOf(codes: readonly number[]): Uint32Array<ArrayBuffer> {
  const mask = new Uint32Array(4);
  for (const code of codes) if (Number.isInteger(code) && code >= 0 && code < 128) mask[code >> 5]! |= 1 << (code & 31);
  return mask;
}
const LIGHT = normalize3(-0.4, -0.5, 0.75);

export interface SurfelProgram {
  program: WebGLProgram;
  uMatrix: WebGLUniformLocation;
  uTileWidth: WebGLUniformLocation;
  uMinRadius: WebGLUniformLocation;
  uExtent: WebGLUniformLocation;
  uLight: WebGLUniformLocation;
  uRight: WebGLUniformLocation;
  uUp: WebGLUniformLocation;
  uSoft: WebGLUniformLocation;
  uShade: WebGLUniformLocation;
  uVivid: WebGLUniformLocation;
  uJitter: WebGLUniformLocation;
  uHideMask: WebGLUniformLocation;
  uHasClass: WebGLUniformLocation;
  uClassColor: WebGLUniformLocation;
  uPalette: WebGLUniformLocation;
  uFalloff: WebGLUniformLocation;
  /** Only in the program that decodes packed records. */
  uZOrigin?: WebGLUniformLocation;
  uZStep?: WebGLUniformLocation;
  /** Only in the program for 12-byte records. */
  uScaleBase?: WebGLUniformLocation;
}

export interface SurfelBuffers {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  /** The tile has per-splat class codes in the `a_class` attribute. */
  hasClasses?: boolean;
  /** The buffer of the class attribute (inside `buffers`), when there is one. */
  classBuffer?: WebGLBuffer;
  /** Set for packed records: the block's z origin and step, metres. */
  z?: { origin: number; step: number; scaleBase: number };
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

// Fixed attribute locations so the VAO does not depend on the program.
const LOC = { corner: 0, position: 1, axisU: 2, axisV: 3, normal: 4, round: 5, color: 6, record: 1, cls: 7 } as const;

/**
 * The drawing program: `"instances"` (float attributes, default), or `16` / `12` for the program that decodes records of
 * that many bytes (packedVertexShader).
 */
export function createSurfelProgram(gl: WebGL2RenderingContext, kind: "instances" | 16 | 12 = "instances"): SurfelProgram {
  const packed = kind !== "instances";
  const vs = compile(gl, gl.VERTEX_SHADER, packed ? packedVertexShader(kind) : VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, LOC.corner, "a_corner");
  gl.bindAttribLocation(program, LOC.cls, "a_class");
  if (packed) {
    gl.bindAttribLocation(program, LOC.record, "a_rec");
  } else {
    gl.bindAttribLocation(program, LOC.position, "a_position");
    gl.bindAttribLocation(program, LOC.axisU, "a_axis_u");
    gl.bindAttribLocation(program, LOC.axisV, "a_axis_v");
    gl.bindAttribLocation(program, LOC.normal, "a_normal");
    gl.bindAttribLocation(program, LOC.round, "a_round");
    gl.bindAttribLocation(program, LOC.color, "a_color");
  }
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  const uniform = (name: string): WebGLUniformLocation => {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) throw new Error(`missing uniform ${name}`);
    return loc;
  };
  return {
    program,
    uMatrix: uniform("u_matrix"),
    uTileWidth: uniform("u_tile_width"),
    uMinRadius: uniform("u_min_radius"),
    uExtent: uniform("u_extent"),
    uLight: uniform("u_light"),
    uRight: uniform("u_right"),
    uUp: uniform("u_up"),
    uSoft: uniform("u_soft"),
    uShade: uniform("u_shade"),
    uVivid: uniform("u_vivid"),
    uJitter: uniform("u_jitter"),
    uHideMask: uniform("u_hide_mask"),
    uHasClass: uniform("u_has_class"),
    uClassColor: uniform("u_class_color"),
    uPalette: uniform("u_palette"),
    uFalloff: uniform("u_falloff"),
    ...(packed ? { uZOrigin: uniform("u_z_origin"), uZStep: uniform("u_z_step") } : {}),
    ...(kind === 12 ? { uScaleBase: uniform("u_scale_base") } : {}),
  };
}

/** Upload a block's 16-byte records as they are (PackedBlock in src/surfel-block.ts); draw them with a packed program. */
export function uploadPacked(
  gl: WebGL2RenderingContext, records: Uint8Array, count: number, zOrigin: number, zStep: number,
  recordBytes: 16 | 12 = 16, scaleBase = 0, classes?: Uint8Array,
): SurfelBuffers {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  const corners = gl.createBuffer();
  const rec = gl.createBuffer();
  if (!corners || !rec) throw new Error("createBuffer failed");
  buffers.push(corners, rec);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, Float32Array.of(-1, -1, 1, -1, -1, 1, 1, 1), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(LOC.corner);
  gl.vertexAttribPointer(LOC.corner, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(LOC.corner, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, rec);
  gl.bufferData(gl.ARRAY_BUFFER, records, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(LOC.record);
  gl.vertexAttribIPointer(LOC.record, recordBytes / 4, gl.UNSIGNED_INT, recordBytes, 0);
  gl.vertexAttribDivisor(LOC.record, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const out: SurfelBuffers = { vao, buffers, count, z: { origin: zOrigin, step: zStep, scaleBase } };
  if (classes) attachClasses(gl, out, classes);
  return out;
}

export function uploadSplats(gl: WebGL2RenderingContext, splats: readonly Splat[]): SurfelBuffers {
  return uploadInstances(gl, splatInstances(splats));
}

/** Upload instance data that was built earlier (so that the decoded Splat objects need not be kept). */
export function uploadInstances(gl: WebGL2RenderingContext, inst: SplatInstances): SurfelBuffers {

  const vao = gl.createVertexArray();
  if (!vao) throw new Error("createVertexArray failed");
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  const attrib = (
    loc: number, data: ArrayBufferView, size: number, type: number, normalized: boolean, divisor: number,
  ): void => {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("createBuffer failed");
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0);
    gl.vertexAttribDivisor(loc, divisor);
  };
  attrib(LOC.corner, Float32Array.of(-1, -1, 1, -1, -1, 1, 1, 1), 2, gl.FLOAT, false, 0);
  attrib(LOC.position, inst.position, 3, gl.FLOAT, false, 1);
  attrib(LOC.axisU, inst.axisU, 3, gl.FLOAT, false, 1);
  attrib(LOC.axisV, inst.axisV, 3, gl.FLOAT, false, 1);
  attrib(LOC.normal, inst.normal, 3, gl.FLOAT, false, 1);
  attrib(LOC.round, inst.round, 1, gl.FLOAT, false, 1);
  attrib(LOC.color, inst.color, 4, gl.UNSIGNED_BYTE, true, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vao, buffers, count: inst.count };
}

export interface DrawOptions {
  /** Local metric frame -> clip, column-major. */
  matrix: Float32Array;
  /** Metres per tile-local unit. */
  tileWidthMetres: number;
  /** Draw only the first `count` instances (default: all). */
  count?: number;
  /** Semi-axis floor in metres (default 0). */
  minRadius?: number;
  /** Factor on every semi-axis (default 1: the 2-sigma ellipse). */
  extent?: number;
  depthTest: boolean;
  /**
   * The soft look (E018): `"core"` draws opaque splats shrunk by `coreScale` (they carry the depth), `"soft"` draws
   * Gaussian-feathered, alpha-blended splats grown by `softScale` on top, testing depth but not writing it. Default
   * `"flat"`: opaque splats of the full extent.
   */
  pass?: "flat" | "core" | "soft";
  /** Bit c of the 128 bits: skip the splats of class code c (hideMaskOf; needs the tile's class codes, E021). */
  hideMask?: Uint32Array;
  /** Color by class (palette in class-palette.ts) instead of the stored color, for tiles that have class codes. */
  classColor?: boolean;
  /** Strength of the shading, 0..1 (default 1: the fixed Lambert light; 0: colors as stored). */
  shade?: number;
  /** Strength of the color grade, 0..: 0 leaves the stored colors, 1 brightens and saturates (see GRADE_GLSL). Default 0. */
  vivid?: number;
  /** Deterministic per-splat shift and growth (JITTER_GLSL); 0 or omitted: as stored. */
  jitter?: number;
  /** Exponent of the Gaussian falloff over the quad in the soft pass (default 3.5 here; the layer uses 6.5, a Gaussian over 3.6 sigma across). */
  falloff?: number;
}

export function drawSurfels(
  gl: WebGL2RenderingContext, p: SurfelProgram, b: SurfelBuffers, opts: DrawOptions,
): void {
  const { right, up } = cameraAxes(opts.matrix);
  gl.useProgram(p.program);
  gl.uniformMatrix4fv(p.uMatrix, false, opts.matrix);
  gl.uniform1f(p.uTileWidth, opts.tileWidthMetres);
  gl.uniform1f(p.uMinRadius, opts.minRadius ?? 0);
  gl.uniform1f(p.uExtent, opts.extent ?? 1);
  gl.uniform3fv(p.uLight, LIGHT);
  gl.uniform3fv(p.uRight, right);
  gl.uniform3fv(p.uUp, up);
  if (p.uZOrigin && p.uZStep) {
    gl.uniform1f(p.uZOrigin, b.z?.origin ?? 0);
    gl.uniform1f(p.uZStep, b.z?.step ?? 1);
  }
  if (p.uScaleBase) gl.uniform1f(p.uScaleBase, b.z?.scaleBase ?? 0);
  const soft = opts.pass === "soft";
  gl.uniform1f(p.uSoft, soft ? 1 : 0);
  gl.uniform1f(p.uShade, opts.shade ?? 1);
  gl.uniform1f(p.uVivid, opts.vivid ?? 0);
  gl.uniform1f(p.uJitter, opts.jitter ?? 0);
  gl.uniform4uiv(p.uHideMask, opts.hideMask ?? NO_HIDDEN_CLASSES);
  gl.uniform1f(p.uHasClass, b.hasClasses ? 1 : 0);
  gl.uniform1f(p.uClassColor, opts.classColor ? 1 : 0);
  gl.uniform3fv(p.uPalette, PALETTE);
  gl.uniform1f(p.uFalloff, opts.falloff ?? 3.5);
  if (opts.depthTest) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(!soft);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.disable(gl.CULL_FACE); // splats are two-sided
  const blendWas = gl.isEnabled(gl.BLEND);
  if (soft) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
  }
  gl.bindVertexArray(b.vao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(b.count, opts.count ?? b.count));
  gl.bindVertexArray(null);
  if (soft) {
    if (!blendWas) gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

/** Make `classes` the tile's class attribute (one byte per splat); a class buffer the tile already has is deleted. */
function attachClasses(gl: WebGL2RenderingContext, b: SurfelBuffers, classes: Uint8Array): void {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("createBuffer failed");
  if (b.classBuffer) {
    gl.deleteBuffer(b.classBuffer);
    const i = b.buffers.indexOf(b.classBuffer);
    if (i >= 0) b.buffers.splice(i, 1);
  }
  b.buffers.push(buffer);
  b.classBuffer = buffer;
  gl.bindVertexArray(b.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, classes, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(LOC.cls);
  gl.vertexAttribPointer(LOC.cls, 1, gl.UNSIGNED_BYTE, false, 0, 0);
  gl.vertexAttribDivisor(LOC.cls, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  b.hasClasses = true;
}

/** Give a tile that is already on the GPU its class codes (they arrive after the tile, once the class plane is inflated). */
export function setBufferClasses(gl: WebGL2RenderingContext, b: SurfelBuffers, classes: Uint8Array): void {
  if (classes.byteLength !== b.count) return; // a plane of another block: ignore
  attachClasses(gl, b, classes);
}

export function deleteSurfelBuffers(gl: WebGL2RenderingContext, b: SurfelBuffers): void {
  for (const buffer of b.buffers) gl.deleteBuffer(buffer);
  gl.deleteVertexArray(b.vao);
}

export function deleteSurfelProgram(gl: WebGL2RenderingContext, p: SurfelProgram): void {
  gl.deleteProgram(p.program);
}

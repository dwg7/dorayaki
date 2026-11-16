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
import { cameraAxes, splatInstances, type SplatInstances } from "./splat-instances.js";

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;      // local metric frame (metres; east, south, up) -> clip
uniform float u_tile_width; // metres per tile-local unit
uniform float u_min_radius; // metres; semi-axis floor when drawing a progressive prefix
uniform float u_extent;     // factor on every semi-axis (1 = the 2-sigma ellipse); covers gaps between neighbours
uniform vec3 u_light;       // local metric frame, normalized
uniform vec3 u_right;       // camera right in the local metric frame, normalized
uniform vec3 u_up;          // camera up in the local metric frame, normalized
in vec2 a_corner;           // quad corner in [-1, 1]^2
in vec3 a_position;         // x, y tile-local; z metres
in vec3 a_axis_u;           // semi-axis vector along the major axis, metres
in vec3 a_axis_v;           // semi-axis vector along the minor axis, metres
in vec3 a_normal;           // shortest axis
in float a_round;           // 1: camera-facing disc of radius |a_axis_u|
in vec4 a_color;
out vec2 v_corner;
out vec3 v_color;
out float v_alpha;
void main() {
  vec3 centre = vec3(a_position.xy * u_tile_width, a_position.z);
  vec3 u = a_axis_u;
  vec3 v = a_axis_v;
  float shade;
  if (a_round > 0.5) {
    float r = max(length(a_axis_u) * u_extent, u_min_radius);
    u = u_right * r;
    v = u_up * r;
    shade = 0.8;
  } else {
    float lu = max(length(u), 1e-9);
    float lv = max(length(v), 1e-9);
    u *= u_extent * max(1.0, u_min_radius / (lu * u_extent));
    v *= u_extent * max(1.0, u_min_radius / (lv * u_extent));
    shade = 0.35 + 0.65 * abs(dot(normalize(a_normal), u_light));
  }
  vec3 p = centre + a_corner.x * u + a_corner.y * v;
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
  v_color = a_color.rgb * shade;
  v_alpha = a_color.a;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_color;
in float v_alpha;
uniform float u_stochastic; // 1: draw a splat only on a share of its pixels equal to its opacity (E017)
out vec4 fragColor;
void main() {
  if (dot(v_corner, v_corner) > 1.0) discard;
  // Screen-door transparency: no sorting, depth is written only where the splat is drawn. Opacities from 0.94 up
  // (the 0.95 every splat carries by default) count as opaque.
  float a = v_alpha < 0.94 ? v_alpha : 1.0;
  if (u_stochastic > 0.5 && a < 1.0) {
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); // interleaved gradient noise
    if (noise > a) discard;
  }
  fragColor = vec4(v_color, 1.0); // opaque, so already premultiplied
}`;

/**
 * The same drawing from the wire record: one 16-byte record per splat is uploaded as it is (four uints per instance)
 * and decoded here, which is 3.5 times less GPU memory than the float attributes above. The decoding mirrors
 * splat-instances.ts (the reference for tests): position (x, y as u16 / 65536, z from a per-tile origin and step),
 * scales 2^(code / 10 - 16), rotation from 24 bits (smallest three: bits 0-1 index of the largest component, then
 * the three others at 7 bits, 63 = 0, scaled by 1 / sqrt 2), colour. Axes are ordered by scale code (ties by index);
 * a splat is round when its largest and smallest codes differ by 5 or less (a ratio below 1.5).
 */
const PACKED_VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_matrix;
uniform float u_tile_width;
uniform float u_min_radius;
uniform float u_extent;
uniform vec3 u_light;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_z_origin;   // metres, of the tile's block
uniform float u_z_step;     // metres per z code
in vec2 a_corner;
in uvec4 a_rec;             // the 16-byte record as four little-endian words
out vec2 v_corner;
out vec3 v_color;
out float v_alpha;
const float QUAT_RANGE = 0.70710678118654752;
void main() {
  uint w0 = a_rec.x, w1 = a_rec.y, w2 = a_rec.z, w3 = a_rec.w;
  vec3 pos = vec3(float(w0 & 0xFFFFu) / 65536.0, float(w0 >> 16) / 65536.0, u_z_origin + float(w1 & 0xFFFFu) * u_z_step);
  uint codes[3] = uint[3](w1 >> 16 & 255u, w1 >> 24, w2 & 255u);
  float sc[3];
  for (int i = 0; i < 3; i++) sc[i] = exp2(float(codes[i]) / 10.0 - 16.0);
  // Rotation: columns of the matrix of the unit quaternion (w, x, y, z).
  uint qb = (w2 >> 8) & 0xFFFFFFu;
  int largest = int(qb & 3u);
  float q[4];
  float sumSq = 0.0;
  uint shift = 2u;
  for (int i = 0; i < 4; i++) {
    if (i == largest) { q[i] = 0.0; continue; }
    float v = (float((qb >> shift) & 127u) - 63.0) / 63.0 * QUAT_RANGE;
    q[i] = v;
    sumSq += v * v;
    shift += 7u;
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
  if (cmax - cmin <= 5u) {
    float r = max(2.0 * sqrt(sa * sb) * u_extent, u_min_radius);
    u = u_right * r;
    v = u_up * r;
    shade = 0.8;
  } else {
    u = aa * 2.0 * sa;
    v = ab * 2.0 * sb;
    float lu = max(length(u), 1e-9);
    float lv = max(length(v), 1e-9);
    u *= u_extent * max(1.0, u_min_radius / (lu * u_extent));
    v *= u_extent * max(1.0, u_min_radius / (lv * u_extent));
    shade = 0.35 + 0.65 * abs(dot(normalize(an), u_light));
  }
  vec3 p = centre + a_corner.x * u + a_corner.y * v;
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
  v_color = vec3(float(w3 & 255u), float((w3 >> 8) & 255u), float((w3 >> 16) & 255u)) / 255.0 * shade;
  v_alpha = float(w3 >> 24) / 255.0;
}`;

/** Light direction in the local metric frame (east, south, up): from the north-west, above. */
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
  /** Only in the program that decodes packed records. */
  uStochastic?: WebGLUniformLocation;
  uZOrigin?: WebGLUniformLocation;
  uZStep?: WebGLUniformLocation;
}

export interface SurfelBuffers {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
  /** Set for packed records: the block's z origin and step, metres. */
  z?: { origin: number; step: number };
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
const LOC = { corner: 0, position: 1, axisU: 2, axisV: 3, normal: 4, round: 5, color: 6, record: 1 } as const;

/** `packed`: the program that decodes 16-byte records (see PACKED_VERTEX_SHADER); default: float attributes. */
export function createSurfelProgram(gl: WebGL2RenderingContext, packed = false): SurfelProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, packed ? PACKED_VERTEX_SHADER : VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, LOC.corner, "a_corner");
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
  const stochastic = gl.getUniformLocation(program, "u_stochastic");
  return {
    program,
    uMatrix: uniform("u_matrix"),
    uTileWidth: uniform("u_tile_width"),
    uMinRadius: uniform("u_min_radius"),
    uExtent: uniform("u_extent"),
    uLight: uniform("u_light"),
    uRight: uniform("u_right"),
    uUp: uniform("u_up"),
    ...(stochastic ? { uStochastic: stochastic } : {}),
    ...(packed ? { uZOrigin: uniform("u_z_origin"), uZStep: uniform("u_z_step") } : {}),
  };
}

/** Upload a block's 16-byte records as they are (PackedBlock in src/surfel-block.ts); draw them with a packed program. */
export function uploadPacked(
  gl: WebGL2RenderingContext, records: Uint8Array, count: number, zOrigin: number, zStep: number,
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
  gl.vertexAttribIPointer(LOC.record, 4, gl.UNSIGNED_INT, 16, 0);
  gl.vertexAttribDivisor(LOC.record, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vao, buffers, count, z: { origin: zOrigin, step: zStep } };
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
  attrib(LOC.color, inst.colour, 4, gl.UNSIGNED_BYTE, true, 1);
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
  /** Screen-door transparency from each splat's opacity (default off: every splat is opaque). */
  stochastic?: boolean;
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
  if (p.uStochastic) gl.uniform1f(p.uStochastic, opts.stochastic ? 1 : 0);
  if (p.uZOrigin && p.uZStep) {
    gl.uniform1f(p.uZOrigin, b.z?.origin ?? 0);
    gl.uniform1f(p.uZStep, b.z?.step ?? 1);
  }
  if (opts.depthTest) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.disable(gl.CULL_FACE); // splats are two-sided
  gl.bindVertexArray(b.vao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(b.count, opts.count ?? b.count));
  gl.bindVertexArray(null);
}

export function deleteSurfelBuffers(gl: WebGL2RenderingContext, b: SurfelBuffers): void {
  for (const buffer of b.buffers) gl.deleteBuffer(buffer);
  gl.deleteVertexArray(b.vao);
}

export function deleteSurfelProgram(gl: WebGL2RenderingContext, p: SurfelProgram): void {
  gl.deleteProgram(p.program);
}

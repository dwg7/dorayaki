/**
 * GPU resources for surfels: shader program, buffer upload, draw call.
 *
 * Deliberately simple: one instanced quad per surfel, oriented in the
 * plane perpendicular to its normal, with fragments outside the unit
 * circle discarded (a flat disc). Lambert shading from a fixed light makes
 * up-, down- and side-facing surfaces distinguishable. No knowledge of
 * MapLibre or of the wire format; input is decoded Surfel objects.
 */
import type { Surfel } from "../../src/surfel-block.js";

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;   // local metric frame (metres; east, south, up) -> clip
uniform float u_tile_width; // metres per tile-local unit
uniform float u_min_radius; // metres; radius floor when drawing a progressive prefix
uniform vec3 u_light;    // local metric frame, normalized
in vec2 a_corner;        // quad corner in [-1, 1]^2
in vec3 a_position;      // x, y tile-local; z metres
in vec3 a_normal;
in float a_radius;       // metres
in vec4 a_color;
out vec2 v_corner;
out vec3 v_color;
void main() {
  vec3 n = normalize(a_normal);
  vec3 helper = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(helper, n));
  vec3 b = cross(n, t);
  vec3 centre = vec3(a_position.xy * u_tile_width, a_position.z);
  float radius = max(a_radius, u_min_radius);
  vec3 p = centre + radius * (a_corner.x * t + a_corner.y * b);
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
  float shade = 0.35 + 0.65 * max(dot(n, u_light), 0.0);
  v_color = a_color.rgb * shade;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_color;
out vec4 fragColor;
void main() {
  if (dot(v_corner, v_corner) > 1.0) discard;
  fragColor = vec4(v_color, 1.0); // opaque, so already premultiplied
}`;

/** Light direction in the local metric frame (east, south, up): from the north-west, above. */
const LIGHT = normalize3(-0.4, -0.5, 0.75);

export interface SurfelProgram {
  program: WebGLProgram;
  uMatrix: WebGLUniformLocation;
  uTileWidth: WebGLUniformLocation;
  uMinRadius: WebGLUniformLocation;
  uLight: WebGLUniformLocation;
}

export interface SurfelBuffers {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
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
const LOC = { corner: 0, position: 1, normal: 2, radius: 3, color: 4 } as const;

export function createSurfelProgram(gl: WebGL2RenderingContext): SurfelProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, LOC.corner, "a_corner");
  gl.bindAttribLocation(program, LOC.position, "a_position");
  gl.bindAttribLocation(program, LOC.normal, "a_normal");
  gl.bindAttribLocation(program, LOC.radius, "a_radius");
  gl.bindAttribLocation(program, LOC.color, "a_color");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  const uMatrix = gl.getUniformLocation(program, "u_matrix");
  const uTileWidth = gl.getUniformLocation(program, "u_tile_width");
  const uMinRadius = gl.getUniformLocation(program, "u_min_radius");
  const uLight = gl.getUniformLocation(program, "u_light");
  if (!uMatrix || !uTileWidth || !uMinRadius || !uLight) throw new Error("missing uniform");
  return { program, uMatrix, uTileWidth, uMinRadius, uLight };
}

export function uploadSurfels(gl: WebGL2RenderingContext, surfels: readonly Surfel[]): SurfelBuffers {
  const n = surfels.length;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const radius = new Float32Array(n);
  const color = new Uint8Array(n * 4);
  surfels.forEach((s, i) => {
    position.set([s.x, s.y, s.z], i * 3);
    normal.set([s.nx, s.ny, s.nz], i * 3);
    radius[i] = s.radius;
    color.set([s.r, s.g, s.b, s.a], i * 4);
  });

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
  attrib(LOC.position, position, 3, gl.FLOAT, false, 1);
  attrib(LOC.normal, normal, 3, gl.FLOAT, false, 1);
  attrib(LOC.radius, radius, 1, gl.FLOAT, false, 1);
  attrib(LOC.color, color, 4, gl.UNSIGNED_BYTE, true, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { vao, buffers, count: n };
}

export interface DrawOptions {
  /** Local metric frame -> clip, column-major. */
  matrix: Float32Array;
  /** Metres per tile-local unit. */
  tileWidthMetres: number;
  /** Draw only the first `count` instances (default: all). */
  count?: number;
  /** Radius floor in metres (default 0). */
  minRadius?: number;
  depthTest: boolean;
}

export function drawSurfels(
  gl: WebGL2RenderingContext, p: SurfelProgram, b: SurfelBuffers, opts: DrawOptions,
): void {
  gl.useProgram(p.program);
  gl.uniformMatrix4fv(p.uMatrix, false, opts.matrix);
  gl.uniform1f(p.uTileWidth, opts.tileWidthMetres);
  gl.uniform1f(p.uMinRadius, opts.minRadius ?? 0);
  gl.uniform3fv(p.uLight, LIGHT);
  if (opts.depthTest) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
  } else {
    gl.disable(gl.DEPTH_TEST);
  }
  gl.disable(gl.CULL_FACE); // discs are two-sided
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

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
import { cameraAxes, splatInstances } from "./splat-instances.js";

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;      // local metric frame (metres; east, south, up) -> clip
uniform float u_tile_width; // metres per tile-local unit
uniform float u_min_radius; // metres; semi-axis floor when drawing a progressive prefix
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
void main() {
  vec3 centre = vec3(a_position.xy * u_tile_width, a_position.z);
  vec3 u = a_axis_u;
  vec3 v = a_axis_v;
  float shade;
  if (a_round > 0.5) {
    float r = max(length(a_axis_u), u_min_radius);
    u = u_right * r;
    v = u_up * r;
    shade = 0.8;
  } else {
    float lu = max(length(u), 1e-9);
    float lv = max(length(v), 1e-9);
    u *= max(1.0, u_min_radius / lu);
    v *= max(1.0, u_min_radius / lv);
    shade = 0.35 + 0.65 * abs(dot(normalize(a_normal), u_light));
  }
  vec3 p = centre + a_corner.x * u + a_corner.y * v;
  gl_Position = u_matrix * vec4(p, 1.0);
  v_corner = a_corner;
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
  uRight: WebGLUniformLocation;
  uUp: WebGLUniformLocation;
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
const LOC = { corner: 0, position: 1, axisU: 2, axisV: 3, normal: 4, round: 5, color: 6 } as const;

export function createSurfelProgram(gl: WebGL2RenderingContext): SurfelProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, LOC.corner, "a_corner");
  gl.bindAttribLocation(program, LOC.position, "a_position");
  gl.bindAttribLocation(program, LOC.axisU, "a_axis_u");
  gl.bindAttribLocation(program, LOC.axisV, "a_axis_v");
  gl.bindAttribLocation(program, LOC.normal, "a_normal");
  gl.bindAttribLocation(program, LOC.round, "a_round");
  gl.bindAttribLocation(program, LOC.color, "a_color");
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
    uLight: uniform("u_light"),
    uRight: uniform("u_right"),
    uUp: uniform("u_up"),
  };
}

export function uploadSplats(gl: WebGL2RenderingContext, splats: readonly Splat[]): SurfelBuffers {
  const inst = splatInstances(splats);

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
  depthTest: boolean;
}

export function drawSurfels(
  gl: WebGL2RenderingContext, p: SurfelProgram, b: SurfelBuffers, opts: DrawOptions,
): void {
  const { right, up } = cameraAxes(opts.matrix);
  gl.useProgram(p.program);
  gl.uniformMatrix4fv(p.uMatrix, false, opts.matrix);
  gl.uniform1f(p.uTileWidth, opts.tileWidthMetres);
  gl.uniform1f(p.uMinRadius, opts.minRadius ?? 0);
  gl.uniform3fv(p.uLight, LIGHT);
  gl.uniform3fv(p.uRight, right);
  gl.uniform3fv(p.uUp, up);
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

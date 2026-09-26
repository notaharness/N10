/**
 * A 30° isometric projection of a ground plane. Ground units are
 * arbitrary; x runs down-right on screen, y down-left, z straight up.
 * The viewer looks from +x/+y, so a box shows its top, its +y face
 * ("left", because it lands on the left of the screen) and its +x face
 * ("right").
 */
const UNIT = 24;
const COS = Math.cos(Math.PI / 6);

/** Width of one track — a ray, or one direction of a beam — in ground units. */
export const TRACK_WIDTH = 0.2;

export type Vec3 = readonly [x: number, y: number, z: number];
export type Vec2 = readonly [x: number, y: number];
export type Tone = 'top' | 'left' | 'right';

export interface Face {
  tone: Tone;
  points: string;
}

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function project([x, y, z]: Vec3): Vec2 {
  return [round((x - y) * COS * UNIT), round((x + y) * 0.5 * UNIT - z * UNIT)];
}

export function toPoints(corners: readonly Vec3[]): string {
  return corners.map((c) => project(c).join(',')).join(' ');
}

export function boxFaces({ x, y, z, w, d, h }: Box): Face[] {
  const [x1, y1, z1] = [x + w, y + d, z + h];
  return [
    {
      tone: 'top',
      points: toPoints([
        [x, y, z1],
        [x1, y, z1],
        [x1, y1, z1],
        [x, y1, z1],
      ]),
    },
    {
      tone: 'left',
      points: toPoints([
        [x, y1, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x, y1, z],
      ]),
    },
    {
      tone: 'right',
      points: toPoints([
        [x1, y, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x1, y, z],
      ]),
    },
  ];
}

/** A rectangle on a box's left (+y) face; u runs along x, v up, both 0–1. */
export function onLeft(b: Box, u0: number, v0: number, u1: number, v1: number) {
  const at = (u: number, v: number): Vec3 => [
    b.x + u * b.w,
    b.y + b.d,
    b.z + v * b.h,
  ];
  return toPoints([at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0)]);
}

/** A rectangle on a box's right (+x) face; u runs along y, v up, both 0–1. */
export function onRight(
  b: Box,
  u0: number,
  v0: number,
  u1: number,
  v1: number
) {
  const at = (u: number, v: number): Vec3 => [
    b.x + b.w,
    b.y + u * b.d,
    b.z + v * b.h,
  ];
  return toPoints([at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0)]);
}

/** A point inside an arbitrary quad (corners in order), by bilinear u, v. */
export function inQuad(
  [a, b, c, d]: readonly [Vec3, Vec3, Vec3, Vec3],
  u: number,
  v: number
): Vec3 {
  const mix = (p: Vec3, q: Vec3, t: number): Vec3 => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
  ];
  return mix(mix(a, b, u), mix(d, c, u), v);
}

/**
 * A flat ribbon along an axis-aligned ground path, one polygon per
 * segment. Each is extended by half the width at both ends, so
 * consecutive segments overlap into a square corner.
 */
export function ribbon(path: readonly Vec2[], width: number): string[] {
  const half = width / 2;
  return path.slice(1).map((to, i) => {
    const from = path[i] as Vec2;
    const [xa, xb] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
    const [ya, yb] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
    return toPoints([
      [xa - half, ya - half, 0],
      [xb + half, ya - half, 0],
      [xb + half, yb + half, 0],
      [xa - half, yb + half, 0],
    ]);
  });
}

/**
 * An axis-aligned path moved sideways into a lane. Adding the same
 * offset to x and y moves every segment square to its own direction,
 * bends included, so two lanes stay the same distance apart throughout.
 */
export function shift(path: readonly Vec2[], offset: number): Vec2[] {
  return path.map(([x, y]) => [x + offset, y + offset]);
}

/** The path's centre line as SVG polyline points, just above the ground. */
export function centreLine(path: readonly Vec2[]): string {
  return toPoints(path.map(([x, y]) => [x, y, 0.02]));
}

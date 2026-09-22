import {
  project,
  toPoints,
  type Face,
  type Tone,
  type Vec2,
  type Vec3,
} from '@/components/beam/mesh/geometry';

/**
 * Boxes that can turn on the ground plane, for stands that face the
 * podium. The beam mesh's boxes are all axis-aligned; here a box has a
 * heading, so which of its sides the viewer sees, and how each is lit,
 * follows from its outward normals. The viewer sits toward +x +y.
 */
export interface Placed {
  cx: number;
  cy: number;
  /** Heading in radians: the direction the box's back faces. */
  heading: number;
}

function rotate([x, y]: Vec2, heading: number): Vec2 {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [x * c - y * s, x * s + y * c];
}

/** A box of size w (across the heading) × d (along it) × h, centred at cx, cy. */
export function turnedBox(
  { cx, cy, heading }: Placed,
  w: number,
  d: number,
  h: number,
  z = 0
): Face[] {
  const local: Vec2[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  const ground = local.map((p) => {
    const [x, y] = rotate(p, heading);
    return [cx + x, cy + y] as Vec2;
  });
  const at = (p: Vec2, zz: number): Vec3 => [p[0], p[1], zz];
  const faces: Face[] = [];
  ground.forEach((a, i) => {
    const b = ground[(i + 1) % 4] as Vec2;
    const mid: Vec2 = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy];
    const len = Math.hypot(mid[0], mid[1]);
    const n: Vec2 = [mid[0] / len, mid[1] / len];
    if (n[0] + n[1] <= 0) return;
    const tone: Tone = n[1] > n[0] ? 'left' : 'right';
    faces.push({
      tone,
      points: toPoints([at(a, z + h), at(b, z + h), at(b, z), at(a, z)]),
    });
  });
  faces.push({
    tone: 'top',
    points: toPoints(ground.map((p) => at(p, z + h))),
  });
  return faces;
}

/** Corners of an upright, tilted panel standing on a box's back edge. */
export function panel(
  { cx, cy, heading }: Placed,
  width: number,
  back: number,
  z: number,
  height: number,
  lean: number
): readonly [Vec3, Vec3, Vec3, Vec3] {
  const side = rotate([1, 0], heading);
  const fwd = rotate([0, 1], heading);
  const base: Vec2 = [cx - fwd[0] * back, cy - fwd[1] * back];
  const top: Vec2 = [base[0] - fwd[0] * lean, base[1] - fwd[1] * lean];
  const corner = (o: Vec2, s: number, zz: number): Vec3 => [
    o[0] + side[0] * s,
    o[1] + side[1] * s,
    zz,
  ];
  const half = width / 2;
  return [
    corner(top, -half, z + height),
    corner(top, half, z + height),
    corner(base, half, z),
    corner(base, -half, z),
  ];
}

/** An arc on the ground around a centre, as projected polyline points. */
export function groundArc(
  centre: Vec2,
  r: number,
  from: number,
  to: number,
  steps = 40
): Vec2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return project([
      centre[0] + Math.cos(a) * r,
      centre[1] + Math.sin(a) * r,
      0,
    ]);
  });
}

export function depth([x, y]: Vec2): number {
  return x + y;
}

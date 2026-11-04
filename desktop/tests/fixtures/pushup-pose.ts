import type { Point } from "../../src/core/engine";

// Independent, fixed-length two-link arm kinematics projected at different
// camera yaws. These are synthetic geometry fixtures, not recorded people.
export function pushupPose(
  degrees: number,
  yaw = 90,
  options: {
    aspect?: number;
    mirror?: boolean;
    world?: boolean;
    hidden?: number[];
    scale?: number;
    sag?: number;
    standing?: boolean;
    noise?: number;
  } = {},
): Point[] {
  const aspect = options.aspect ?? 16 / 9;
  const scale = (options.scale ?? 0.42) * Math.min(1, aspect);
  const r = (degrees * Math.PI) / 180,
    a = (yaw * Math.PI) / 180;
  const height = 0.56 * Math.sin(r / 2),
    bend = 0.28 * Math.cos(r / 2);
  const points: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  const add = (i: number, x: number, y: number, z: number) => {
    const cx = Math.sin(a) * x + Math.cos(a) * z;
    const cz = Math.cos(a) * x - Math.sin(a) * z;
    const n = (options.noise ?? 0) * Math.sin(i * 7 + degrees);
    points[i] = {
      x: 0.5 + ((cx - Math.sin(a) * 0.6) * scale) / aspect + n,
      y: 0.82 + y * scale + n,
      z: (cz * scale) / aspect,
      visibility: options.hidden?.includes(i) ? 0.1 : 0.95,
      ...(options.world === false ? {} : { world: { x: cx, y, z: cz } }),
    };
    if (options.mirror) {
      points[i].x = 1 - points[i].x;
      if (points[i].world) points[i].world!.x *= -1;
    }
  };
  for (const o of [0, 1]) {
    const z = o ? 0.22 : -0.22;
    add(11 + o, 0, -height, z);
    add(13 + o, bend, -height / 2, z);
    add(15 + o, 0, 0, z);
    add(
      23 + o,
      options.standing ? 0 : 0.6,
      options.standing
        ? 0.1
        : -height + ((height - 0.05) * 0.6) / 1.35 + (options.sag ?? 0),
      z * 0.7,
    );
    add(25 + o, 1, -height + (height - 0.05) / 1.35, z * 0.5);
    add(27 + o, 1.35, -0.05, z * 0.5);
  }
  add(0, -0.18, -height - 0.05, 0);
  return points;
}

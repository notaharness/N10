import {
  boxFaces,
  inQuad,
  onLeft,
  onRight,
  toPoints,
  type Box,
  type Vec3,
} from './geometry';

function Faces({ box, className }: { box: Box; className?: string }) {
  return (
    <g className={className}>
      {boxFaces(box).map((face) => (
        <polygon
          key={face.tone}
          points={face.points}
          className={`n10-iso-face n10-iso-face--${face.tone}`}
        />
      ))}
    </g>
  );
}

/** A soft patch of shade under a machine, a little larger than its footprint. */
function Shadow({ box }: { box: Box }) {
  const grow = 0.18;
  return (
    <polygon
      className="n10-iso-shadow"
      points={toPoints([
        [box.x - grow, box.y - grow, 0],
        [box.x + box.w + grow, box.y - grow, 0],
        [box.x + box.w + grow, box.y + box.d + grow, 0],
        [box.x - grow, box.y + box.d + grow, 0],
      ])}
    />
  );
}

/** A headless build box: a short stack of rack units with status lights. */
export function Rack({ cx, cy }: { cx: number; cy: number }) {
  const units = [0, 1, 2, 3].map(
    (k): Box => ({
      x: cx - 1.3,
      y: cy - 1.3,
      z: k * 0.62,
      w: 2.6,
      d: 2.6,
      h: 0.5,
    })
  );
  return (
    <g>
      <Shadow box={units[0] as Box} />
      {units.map((unit, k) => (
        <g key={unit.z}>
          <Faces box={unit} />
          <polygon
            points={onLeft(unit, 0.3, 0.35, 0.92, 0.65)}
            className="n10-iso-inset"
          />
          <polygon
            points={onLeft(unit, 0.08, 0.35, 0.14, 0.65)}
            className="n10-iso-led"
            style={{ animationDelay: `${k * -0.7}s` }}
          />
          <polygon
            points={onLeft(unit, 0.17, 0.35, 0.23, 0.65)}
            className="n10-iso-led n10-iso-led--sand"
            style={{ animationDelay: `${k * -1.1 - 0.4}s` }}
          />
          <polygon
            points={onRight(unit, 0.1, 0.35, 0.9, 0.65)}
            className="n10-iso-inset"
          />
        </g>
      ))}
    </g>
  );
}

/** A workstation tower, its side panel lit from inside. */
export function Tower({ cx, cy }: { cx: number; cy: number }) {
  const body: Box = {
    x: cx - 0.75,
    y: cy - 1.3,
    z: 0,
    w: 1.5,
    d: 2.6,
    h: 3,
  };
  return (
    <g>
      <Shadow box={body} />
      <Faces box={body} />
      <polygon
        points={onRight(body, 0.1, 0.12, 0.9, 0.88)}
        className="n10-iso-glass"
      />
      <polygon
        points={onRight(body, 0.2, 0.3, 0.8, 0.42)}
        className="n10-iso-glow"
      />
      <polygon
        points={onLeft(body, 0.2, 0.62, 0.8, 0.68)}
        className="n10-iso-inset"
      />
      <polygon
        points={onLeft(body, 0.2, 0.5, 0.8, 0.56)}
        className="n10-iso-inset"
      />
      <polygon
        points={onLeft(body, 0.2, 0.08, 0.8, 0.3)}
        className="n10-iso-inset"
      />
      <polygon
        points={onLeft(body, 0.42, 0.84, 0.58, 0.9)}
        className="n10-iso-led"
      />
    </g>
  );
}

/** Lines of code on the laptop's screen: how far down, from, to, colour. */
const CODE_LINES: readonly {
  v: number;
  u0: number;
  u1: number;
  tone: 'sage' | 'sand' | 'muted';
}[] = [
  { v: 0.2, u0: 0.14, u1: 0.56, tone: 'sage' },
  { v: 0.305, u0: 0.2, u1: 0.78, tone: 'sand' },
  { v: 0.41, u0: 0.2, u1: 0.5, tone: 'sage' },
  { v: 0.515, u0: 0.26, u1: 0.68, tone: 'muted' },
  { v: 0.62, u0: 0.2, u1: 0.44, tone: 'sand' },
  { v: 0.725, u0: 0.14, u1: 0.36, tone: 'sage' },
];

/** Your laptop: open, facing the viewer, a few lines of code on screen. */
export function Laptop({ cx, cy }: { cx: number; cy: number }) {
  const base: Box = {
    x: cx - 1.5,
    y: cy - 0.8,
    z: 0,
    w: 3,
    d: 2,
    h: 0.14,
  };
  const deck = base.z + base.h;
  const lid: readonly [Vec3, Vec3, Vec3, Vec3] = [
    [base.x, base.y - 0.55, deck + 1.85],
    [base.x + base.w, base.y - 0.55, deck + 1.85],
    [base.x + base.w, base.y + 0.06, deck],
    [base.x, base.y + 0.06, deck],
  ];
  const display = [
    inQuad(lid, 0.05, 0.07),
    inQuad(lid, 0.95, 0.07),
    inQuad(lid, 0.95, 0.9),
    inQuad(lid, 0.05, 0.9),
  ];
  return (
    <g>
      <Shadow box={base} />
      <Faces box={base} />
      <polygon
        points={toPoints([
          [base.x + 0.3, base.y + 0.35, deck],
          [base.x + base.w - 0.3, base.y + 0.35, deck],
          [base.x + base.w - 0.3, base.y + 1.2, deck],
          [base.x + 0.3, base.y + 1.2, deck],
        ])}
        className="n10-iso-inset"
      />
      <polygon
        points={toPoints(lid)}
        className="n10-iso-face n10-iso-face--left"
      />
      <polygon points={toPoints(display)} className="n10-iso-screen" />
      {CODE_LINES.map(({ v, u0, u1, tone }) => (
        <polyline
          key={v}
          points={toPoints([inQuad(lid, u0, v), inQuad(lid, u1, v)])}
          className={`n10-iso-code n10-iso-code--${tone}`}
        />
      ))}
    </g>
  );
}

/** A small always-on box, the kind that lives on a shelf. */
export function Mini({ cx, cy }: { cx: number; cy: number }) {
  const body: Box = {
    x: cx - 0.95,
    y: cy - 0.95,
    z: 0,
    w: 1.9,
    d: 1.9,
    h: 0.6,
  };
  return (
    <g>
      <Shadow box={body} />
      <Faces box={body} />
      <polygon
        points={onLeft(body, 0.1, 0.35, 0.18, 0.6)}
        className="n10-iso-led"
        style={{ animationDelay: '-1.6s' }}
      />
      <polygon
        points={onLeft(body, 0.5, 0.3, 0.9, 0.62)}
        className="n10-iso-inset"
      />
      <polygon
        points={onRight(body, 0.15, 0.3, 0.85, 0.62)}
        className="n10-iso-inset"
      />
    </g>
  );
}

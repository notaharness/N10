/**
 * The other machine being offline is a normal state, not a failure —
 * this walks through what happens to a message sent while it's asleep.
 */
const panels = [
  { label: 'sent while offline', sub: 'held on disk, nothing lost' },
  { label: 'the machine reconnects', sub: 'over whichever side dials' },
  { label: 'delivered', sub: 'exactly once, in order' },
];

export function BeamQueueDiagram() {
  return (
    <div className="n10-frame bg-fd-card mx-auto mb-8 w-full max-w-3xl rounded-xl p-6">
      <svg
        viewBox="0 0 640 150"
        className="h-auto w-full"
        role="img"
        aria-label="A message sent to an offline machine is held on disk, then delivered as soon as that machine reconnects."
      >
        <defs>
          <marker
            id="beam-q-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--color-fd-muted-foreground)" />
          </marker>
        </defs>
        {panels.map((panel, i) => {
          const x = 24 + i * 210;
          return (
            <g key={panel.label}>
              <rect
                x={x}
                y="20"
                width="176"
                height="90"
                rx="12"
                fill="var(--color-fd-background)"
                stroke={
                  i === 2 ? 'var(--color-fd-primary)' : 'var(--color-fd-border)'
                }
                strokeWidth={i === 2 ? 2 : 1.5}
              />
              <text
                x={x + 88}
                y="58"
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill="var(--color-fd-foreground)"
              >
                {panel.label}
              </text>
              <text
                x={x + 88}
                y="80"
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-fd-muted-foreground)"
              >
                {panel.sub}
              </text>
              {i < panels.length - 1 && (
                <line
                  x1={x + 178}
                  y1="65"
                  x2={x + 202}
                  y2="65"
                  stroke="var(--color-fd-muted-foreground)"
                  markerEnd="url(#beam-q-arrow)"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

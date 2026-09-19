/**
 * The core pitch in one picture: today an agent only runs where you're
 * sitting; with beam, a second machine holds the same two boxes (tmux,
 * the agent) and one connection joins them. Colours come from the
 * fd-* tokens directly (not Tailwind classes) so the SVG repaints for
 * dark mode the same way the rest of the page does.
 */
export function BeamOverviewDiagram() {
  return (
    <div className="border-fd-border bg-fd-card mx-auto max-w-3xl rounded-lg border p-6">
      <svg
        viewBox="0 0 640 220"
        className="h-auto w-full"
        role="img"
        aria-label="Without beam, tmux and your agent run only on your machine. With beam, a paired machine runs the same two things, reached over one connection."
      >
        <defs>
          <marker
            id="beam-ov-arrow"
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

        <rect
          x="16"
          y="16"
          width="220"
          height="188"
          rx="14"
          fill="none"
          stroke="var(--color-fd-border)"
          strokeWidth="1.5"
        />
        <text
          x="126"
          y="40"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="var(--color-fd-foreground)"
        >
          Your machine
        </text>
        <rect
          x="36"
          y="60"
          width="180"
          height="40"
          rx="8"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="126"
          y="84"
          textAnchor="middle"
          fontSize="12"
          fill="var(--color-fd-foreground)"
        >
          n10 or Orchestra
        </text>
        <line
          x1="126"
          y1="100"
          x2="126"
          y2="126"
          stroke="var(--color-fd-muted-foreground)"
          markerEnd="url(#beam-ov-arrow)"
        />
        <rect
          x="36"
          y="130"
          width="180"
          height="40"
          rx="8"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="126"
          y="154"
          textAnchor="middle"
          fontSize="12"
          fill="var(--color-fd-foreground)"
        >
          tmux + your agent
        </text>

        <rect
          x="404"
          y="16"
          width="220"
          height="188"
          rx="14"
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text
          x="514"
          y="40"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="var(--color-fd-foreground)"
        >
          A paired machine
        </text>
        <rect
          x="424"
          y="60"
          width="180"
          height="40"
          rx="8"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="514"
          y="84"
          textAnchor="middle"
          fontSize="12"
          fill="var(--color-fd-foreground)"
        >
          beam node
        </text>
        <line
          x1="514"
          y1="100"
          x2="514"
          y2="126"
          stroke="var(--color-fd-muted-foreground)"
          markerEnd="url(#beam-ov-arrow)"
        />
        <rect
          x="424"
          y="130"
          width="180"
          height="40"
          rx="8"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="514"
          y="154"
          textAnchor="middle"
          fontSize="12"
          fill="var(--color-fd-foreground)"
        >
          tmux + another agent
        </text>

        <line
          x1="238"
          y1="120"
          x2="402"
          y2="120"
          stroke="var(--color-fd-primary)"
          strokeWidth="2.5"
          markerEnd="url(#beam-ov-arrow)"
          markerStart="url(#beam-ov-arrow)"
        />
        <rect
          x="270"
          y="106"
          width="100"
          height="24"
          rx="12"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-primary)"
        />
        <text
          x="320"
          y="122"
          textAnchor="middle"
          fontSize="11"
          fontFamily="var(--font-mono, monospace)"
          fill="var(--color-fd-primary)"
        >
          beam
        </text>
      </svg>
      <p className="text-fd-muted-foreground mt-4 text-center text-sm">
        Beam is the connection in the middle. Everything on either side — tmux,
        your worktrees, the agent itself — works exactly like it does today.
      </p>
    </div>
  );
}

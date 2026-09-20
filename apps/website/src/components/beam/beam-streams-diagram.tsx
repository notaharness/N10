/**
 * One connection, three independent channels — visualises why beam
 * connect / exec / msg don't queue behind each other. See BeamStreams
 * for the prose version of the same three rows.
 */
export function BeamStreamsDiagram() {
  return (
    <div className="n10-frame bg-fd-card mx-auto mb-8 w-full max-w-3xl rounded-xl p-6">
      <svg
        viewBox="0 0 640 190"
        className="h-auto w-full"
        role="img"
        aria-label="One beam connection between two machines carries three channels at once: pty, exec and msg."
      >
        <rect
          x="16"
          y="60"
          width="140"
          height="70"
          rx="12"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="86"
          y="99"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="var(--color-fd-foreground)"
        >
          your laptop
        </text>
        <rect
          x="484"
          y="60"
          width="140"
          height="70"
          rx="12"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
        />
        <text
          x="554"
          y="99"
          textAnchor="middle"
          fontSize="13"
          fontWeight="600"
          fill="var(--color-fd-foreground)"
        >
          paired machine
        </text>

        <line
          x1="158"
          y1="76"
          x2="482"
          y2="76"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
        />
        <text
          x="320"
          y="69"
          textAnchor="middle"
          fontSize="11"
          fontFamily="var(--font-mono, monospace)"
          fill="var(--color-fd-primary)"
        >
          pty — a real terminal
        </text>

        <line
          x1="158"
          y1="97"
          x2="482"
          y2="97"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
        />
        <text
          x="320"
          y="90"
          textAnchor="middle"
          fontSize="11"
          fontFamily="var(--font-mono, monospace)"
          fill="var(--color-fd-primary)"
        >
          exec — one command, its result
        </text>

        <line
          x1="158"
          y1="118"
          x2="482"
          y2="118"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
        />
        <text
          x="320"
          y="111"
          textAnchor="middle"
          fontSize="11"
          fontFamily="var(--font-mono, monospace)"
          fill="var(--color-fd-primary)"
        >
          msg — messages that wait
        </text>

        <text
          x="320"
          y="163"
          textAnchor="middle"
          fontSize="11"
          fill="var(--color-fd-muted-foreground)"
        >
          all three run over the one connection opened after pairing
        </text>
      </svg>
    </div>
  );
}

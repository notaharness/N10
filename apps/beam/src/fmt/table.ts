/**
 * A small aligned-column table formatter for the human-readable form of
 * every read command (`peers`, `status`, `msg queue`). `--json` bypasses
 * this entirely and prints one JSON value instead.
 */

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? '').length))
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, col) => cell.padEnd(widths[col] ?? 0))
      .join('  ')
      .trimEnd();
  const lines = [line(headers), ...rows.map((row) => line(row))];
  return `${lines.join('\n')}\n`;
}

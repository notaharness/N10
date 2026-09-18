/** `--json` always prints exactly one JSON value and nothing else, so a
 * pipe never sees a banner or a progress line mixed into its input. */
export function printJson(
  io: { write(chunk: string): void },
  value: unknown
): void {
  io.write(`${JSON.stringify(value)}\n`);
}

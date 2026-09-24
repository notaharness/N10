/** Empty names request beam's default; nonempty names are never rewritten. */
export function validBeamName(value: string): boolean {
  return (
    value === '' ||
    ([...value].length <= 64 && !/[/\\{}\p{Cc}\p{Cs}]/u.test(value))
  );
}

export const NAME_HINT =
  'Use 1–64 characters without /, \\, {, }, or control characters. Leave blank to use the default.';

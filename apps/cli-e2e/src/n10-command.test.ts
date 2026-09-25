import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

// The built `n10` executable's routing. The TUI path is every other
// test here (through `--tui`); these cover what returns without it.
const binary = fileURLToPath(
  new URL('../../cli/dist/main.js', import.meta.url)
);

function n10(...args: string[]) {
  return spawnSync(process.execPath, [binary, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('--version prints the package version', () => {
  const result = n10('--version');
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test('--help lists the commands', () => {
  const result = n10('--help');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('n10 --tui');
  expect(result.stdout).toContain('n10 util add-comment');
});

test('util add-comment runs without the TUI and reports missing fields', () => {
  const result = n10('util', 'add-comment');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Missing required fields');
  expect(result.stderr).toContain('Usage: n10 util add-comment');
});

test('an unknown argument fails with the usage', () => {
  const result = n10('/some/repo');
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("unknown argument '/some/repo'");
  expect(result.stderr).toContain('Usage:');
});

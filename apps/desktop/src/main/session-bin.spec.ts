import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSessionBin } from './session-bin.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "n10 session's bin-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for the shim bundle: prints what it was run with. */
function echoShim(): string {
  const shim = join(dir, 'shim.mjs');
  writeFileSync(
    shim,
    'console.log(JSON.stringify({ args: process.argv.slice(2), node: process.env.ELECTRON_RUN_AS_NODE }));\n'
  );
  return shim;
}

describe('writeSessionBin', () => {
  it('writes an n10 that runs the shim under the app runtime as Node', () => {
    const bin = join(dir, 'bin');
    writeSessionBin(bin, { runtime: process.execPath, shim: echoShim() });
    const run = spawnSync(
      join(bin, 'n10'),
      ['util', 'add-comment', "--body=it's"],
      {
        encoding: 'utf8',
      }
    );
    expect(JSON.parse(run.stdout)).toEqual({
      args: ['util', 'add-comment', "--body=it's"],
      node: '1',
    });
  });

  it('links beam to the binary the app runs, replacing an older link', () => {
    const bin = join(dir, 'bin');
    const shim = echoShim();
    writeSessionBin(bin, {
      runtime: process.execPath,
      shim,
      beam: '/old/beam',
    });
    writeSessionBin(bin, {
      runtime: process.execPath,
      shim,
      beam: '/new/beam',
    });
    expect(readlinkSync(join(bin, 'beam'))).toBe('/new/beam');
  });
});

describe('n10 outside `util`', () => {
  /** An executable that prints its name and arguments. */
  function fakeN10(at: string, name: string): void {
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'n10'), `#!/bin/sh\necho ${name} "$@"\n`);
    chmodSync(join(at, 'n10'), 0o755);
  }

  it('runs the next n10 on PATH that is not a session bin, however many there are', () => {
    const shim = echoShim();
    const first = join(dir, 'first');
    const second = join(dir, 'second');
    writeSessionBin(first, { runtime: process.execPath, shim });
    writeSessionBin(second, { runtime: process.execPath, shim });
    fakeN10(join(dir, 'cli'), 'cli');
    const run = spawnSync(join(first, 'n10'), ['--version'], {
      encoding: 'utf8',
      env: {
        PATH: [first, second, join(dir, 'cli'), '/usr/bin', '/bin'].join(':'),
      },
      timeout: 5000,
    });
    expect(run.stdout.trim()).toBe('cli --version');
  });

  it('says what it is for when no n10 CLI is installed', () => {
    const bin = join(dir, 'bin');
    writeSessionBin(bin, { runtime: process.execPath, shim: echoShim() });
    const run = spawnSync(join(bin, 'n10'), [], {
      encoding: 'utf8',
      env: { PATH: [bin, '/usr/bin', '/bin'].join(':') },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/runs only `n10 util`/);
  });
});

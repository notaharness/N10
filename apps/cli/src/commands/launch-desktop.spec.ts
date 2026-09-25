import { exitStatus, sandboxArgs } from './launch-desktop.js';

const ELECTRON = '/pkg/node_modules/electron/dist/electron';

function helper(uid: number, mode: number) {
  return (path: string) => {
    expect(path).toBe('/pkg/node_modules/electron/dist/chrome-sandbox');
    return { uid, mode };
  };
}

describe('sandboxArgs', () => {
  it('keeps the sandbox when root owns a setuid helper', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(0, 0o104755))).toEqual([]);
  });

  it('disables it when the user owns the helper, as npm leaves it', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(1000, 0o104755))).toEqual([
      '--no-sandbox',
    ]);
  });

  it('disables it when the helper lacks the setuid bit', () => {
    expect(sandboxArgs(ELECTRON, 'linux', helper(0, 0o100755))).toEqual([
      '--no-sandbox',
    ]);
  });

  it('disables it when there is no helper', () => {
    const missing = () => {
      throw new Error('ENOENT');
    };
    expect(sandboxArgs(ELECTRON, 'linux', missing)).toEqual(['--no-sandbox']);
  });

  it('leaves other platforms alone', () => {
    const unused = () => {
      throw new Error('not consulted');
    };
    expect(sandboxArgs(ELECTRON, 'darwin', unused)).toEqual([]);
    expect(sandboxArgs(ELECTRON, 'win32', unused)).toEqual([]);
  });
});

describe('exitStatus', () => {
  it("passes Electron's exit code through", () => {
    expect(exitStatus(0, null)).toBe(0);
    expect(exitStatus(3, null)).toBe(3);
  });

  it('reports a signal death as 128 plus the signal, never success', () => {
    expect(exitStatus(null, 'SIGTRAP')).toBe(133);
    expect(exitStatus(null, 'SIGSEGV')).toBe(139);
  });
});

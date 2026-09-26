import { describe, it, expect } from 'vitest';
import {
  loadRetryDelay,
  rendererLogLine,
  reportRepeat,
} from './window-diagnostics.js';

describe('loadRetryDelay', () => {
  it('doubles from one second and settles at ten', () => {
    expect([1, 2, 3, 4, 5, 6].map(loadRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 10_000, 10_000,
    ]);
  });
});

describe('rendererLogLine', () => {
  it('keeps errors, with where they came from', () => {
    expect(
      rendererLogLine(
        {
          level: 'error',
          message: 'Uncaught Error: x',
          sourceId: 'file:///a.js',
          lineNumber: 7,
        },
        false
      )
    ).toEqual({
      level: 'error',
      line: 'renderer: Uncaught Error: x (file:///a.js:7)',
    });
  });

  it('drops other levels outside the dev server', () => {
    expect(
      rendererLogLine({ level: 'info', message: '[vite] connected.' }, false)
    ).toBeNull();
    expect(
      rendererLogLine({ level: 'warn', message: 'careful' }, true)
    ).toBeNull();
  });

  it('keeps everything the Vite client says under the dev server', () => {
    expect(
      rendererLogLine({ level: 'info', message: '[vite] connected.' }, true)
    ).toEqual({
      level: 'info',
      line: 'renderer: [vite] connected.',
    });
    expect(
      rendererLogLine(
        {
          level: 'warn',
          message: 'server connection lost',
          sourceId: 'http://localhost:5173/@vite/client',
          lineNumber: 1,
        },
        true
      )?.level
    ).toBe('warn');
  });
});

describe('reportRepeat', () => {
  it('reports at each power of ten from ten on', () => {
    expect([1, 2, 9, 10, 11, 99, 100, 1000, 1001].map(reportRepeat)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      false,
    ]);
  });
});

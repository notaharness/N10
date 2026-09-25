// @vitest-environment happy-dom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.js';

declare global {
  // React reads this global to allow act().
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error('render exploded');
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  // React reports the caught error through console.error either way.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary at the root', () => {
  it('shows the error and a reload button instead of an empty page', () => {
    const reload = vi.fn();
    act(() => {
      root.render(
        <ErrorBoundary label="n10 hit an error." reload={reload}>
          <Boom />
        </ErrorBoundary>
      );
    });
    expect(host.textContent).toContain('n10 hit an error.');
    expect(host.textContent).toContain('render exploded');
    const button = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Reload window')
    );
    expect(button).toBeDefined();
    act(() => button?.click());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers no reload without one to call', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      );
    });
    expect(host.textContent).toContain('Try again');
    expect(host.textContent).not.toContain('Reload window');
  });
});

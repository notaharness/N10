import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetLaunchMenuRequestForTests,
  clearLaunchMenuRequest,
  LAUNCH_MENU_REQUEST_TTL_MS,
  pendingLaunchMenu,
  requestLaunchMenu,
  subscribeLaunchMenu,
} from './launch-menu-request.js';

beforeEach(() => {
  __resetLaunchMenuRequestForTests();
});

describe('launch menu request', () => {
  it('holds one request at a time, newest wins', () => {
    requestLaunchMenu('alpha');
    requestLaunchMenu('beta');
    expect(pendingLaunchMenu()).toBe('beta');
  });

  it('clears only the branch it is asked to clear', () => {
    requestLaunchMenu('alpha');
    clearLaunchMenuRequest('other');
    expect(pendingLaunchMenu()).toBe('alpha');
    clearLaunchMenuRequest('alpha');
    expect(pendingLaunchMenu()).toBeNull();
  });

  it('notifies subscribers on every change, and not after unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeLaunchMenu(cb);
    requestLaunchMenu('alpha');
    clearLaunchMenuRequest('alpha');
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    requestLaunchMenu('beta');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('does not notify for a clear that changes nothing', () => {
    const cb = vi.fn();
    subscribeLaunchMenu(cb);
    clearLaunchMenuRequest('alpha');
    expect(cb).not.toHaveBeenCalled();
  });

  it('expires after the TTL instead of popping a menu later', () => {
    requestLaunchMenu('alpha', 1_000);
    expect(pendingLaunchMenu(1_000 + LAUNCH_MENU_REQUEST_TTL_MS)).toBe('alpha');
    expect(
      pendingLaunchMenu(1_000 + LAUNCH_MENU_REQUEST_TTL_MS + 1)
    ).toBeNull();
  });
});

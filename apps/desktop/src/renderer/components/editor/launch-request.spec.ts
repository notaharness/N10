import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core';
import { reviewLaunchRequest, sessionLaunchRequest } from './launch-request.js';

function pr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    title: 'Add colour support',
    sourceBranch: 'feature/colour',
    targetBranch: 'main',
    createdByDisplayName: 'someone',
    isDraft: false,
    url: 'https://example.test/pr/42',
    ...overrides,
  } as PullRequestInfo;
}

describe('sessionLaunchRequest', () => {
  it('a local launch submits exactly the request it submits today (pinned)', () => {
    expect(
      sessionLaunchRequest('feature/x', true, { cols: 120, rows: 40 })
    ).toStrictEqual({
      branch: 'feature/x',
      intent: 'blank',
      fresh: true,
      expected: undefined,
      agentId: undefined,
      cols: 120,
      rows: 40,
    });
  });

  it('continuing (fresh: false) sends the continue-or-blank intent', () => {
    expect(sessionLaunchRequest('feature/x', false, {})).toMatchObject({
      intent: 'continue-or-blank',
      fresh: false,
    });
  });

  it('a local launch never carries a machine or a launchId, even if only launchId is passed', () => {
    const req = sessionLaunchRequest(
      'feature/x',
      true,
      {},
      undefined,
      undefined,
      undefined,
      'launch-1'
    );
    expect(req).not.toHaveProperty('machine');
    expect(req).not.toHaveProperty('launchId');
  });

  it('a remote launch carries the machine and the launchId', () => {
    expect(
      sessionLaunchRequest(
        'feature/x',
        true,
        { cols: 80, rows: 24 },
        undefined,
        'claude',
        'peer-abc',
        'launch-1'
      )
    ).toStrictEqual({
      branch: 'feature/x',
      intent: 'blank',
      fresh: true,
      expected: undefined,
      agentId: 'claude',
      machine: 'peer-abc',
      launchId: 'launch-1',
      cols: 80,
      rows: 24,
    });
  });
});

describe('reviewLaunchRequest', () => {
  const thePr = pr();

  it('a local review launch submits exactly the request it submits today (pinned)', () => {
    expect(
      reviewLaunchRequest(thePr, 'Check module boundaries.', {
        cols: 80,
        rows: 24,
      })
    ).toStrictEqual({
      pr: thePr,
      instruction: 'Check module boundaries.',
      expected: undefined,
      agentId: undefined,
      cols: 80,
      rows: 24,
    });
  });

  it('a local review launch never carries a machine or a launchId', () => {
    const req = reviewLaunchRequest(thePr, undefined, {});
    expect(req).not.toHaveProperty('machine');
    expect(req).not.toHaveProperty('launchId');
  });

  it('a remote review launch carries the machine and the launchId', () => {
    expect(
      reviewLaunchRequest(
        thePr,
        undefined,
        { cols: 80, rows: 24 },
        undefined,
        undefined,
        'peer-abc',
        'launch-2'
      )
    ).toStrictEqual({
      pr: thePr,
      instruction: undefined,
      expected: undefined,
      agentId: undefined,
      machine: 'peer-abc',
      launchId: 'launch-2',
      cols: 80,
      rows: 24,
    });
  });
});

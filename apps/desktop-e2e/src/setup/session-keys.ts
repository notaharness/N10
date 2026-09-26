import type { Page } from '@playwright/test';

/**
 * The worktree a session key names, by its directory's name — for
 * assertions, while IPC always receives the opaque key. A key is its
 * checkout, and e2e branches are slash-free, so for a worktree n10
 * created this is the branch it was created for.
 */
export function sessionBranch(key: string): string {
  const [kind, , path] = JSON.parse(key) as string[];
  if (kind !== 'worktree' || !path)
    throw new Error(`Not a worktree key: ${key}`);
  return path.split('/').pop()!;
}

export async function sessionKey(page: Page, branch: string): Promise<string> {
  const sessions = await page.evaluate(() => window.n10.listSessions());
  const session = sessions.find((s) => sessionBranch(s.name) === branch);
  if (!session) throw new Error(`No session for ${branch}`);
  return session.name;
}

import { AlertTriangleIcon } from 'lucide-react';

/**
 * Shown at the top of a tab whose worktree is on a different branch
 * from the one the tab was opened for — someone ran `git switch` in
 * it. Informational only: the tab follows the worktree, but its pull
 * request context is the new branch's, which may not be what the
 * agent in it was started to work on.
 */
export function BranchSwitchBanner({
  current,
  original,
}: {
  current: string;
  original: string;
}) {
  return (
    <div
      role="status"
      aria-label="Branch switched"
      className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-warning"
    >
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        This worktree is on <code className="font-mono">{current}</code>, not{' '}
        <code className="font-mono">{original}</code>, the branch this tab was
        opened for.
      </span>
    </div>
  );
}

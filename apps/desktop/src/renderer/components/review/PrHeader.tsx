import {
  CheckCircle2Icon,
  CircleDotIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  XCircleIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PullRequestInfo } from '@n10/vcs-core';
import { useOpenInEditor } from '../../lib/data/mutations.js';
import { unresolvedCommentsLabel } from '../../lib/sidebar/sidebar-model.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { Avatar } from '../ui/avatar.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Tip } from '../ui/tooltip.js';

/** Launch the configured external editor on the branch's worktree. */
export function OpenInEditorButton({ branch }: { branch: string }) {
  const open = useOpenInEditor();
  return (
    <Tip label="Open worktree in editor">
      <Button
        variant="ghost"
        size="sm"
        disabled={open.isPending}
        onClick={() =>
          open.mutate(branch, {
            onSuccess: ({ editor }) => toast.success(`Opened in ${editor}`),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      >
        <CodeIcon /> Editor
      </Button>
    </Tip>
  );
}

/** CI verdict, or nothing at all when no build has reported. */
function CiBadge({ ci }: { ci: PullRequestInfo['buildStatus'] }) {
  if (!ci || ci === 'none') return null;
  const variant =
    ci === 'succeeded'
      ? 'success'
      : ci === 'failed'
      ? 'destructive'
      : 'warning';
  return (
    <Badge variant={variant}>
      {ci === 'succeeded' && <CheckCircle2Icon />}
      {ci === 'failed' && <XCircleIcon />}
      {ci === 'pending' && <CircleDotIcon />}
      CI {ci}
    </Badge>
  );
}

/** Colour of the dot on a reviewer's avatar, by their verdict. */
function decisionDotClass(decision: string): string {
  if (decision === 'approved') return 'bg-success';
  if (decision === 'rejected') return 'bg-destructive';
  if (decision === 'changes-requested' || decision === 'waiting-for-author') {
    return 'bg-warning';
  }
  if (decision === 'no-response') return 'bg-muted-foreground/50';
  if (decision === 'declined') return 'bg-muted-foreground';
  return '';
}

/** Reviewer avatars, each dotted with where that reviewer landed. */
function ReviewerDots({
  reviewers,
}: {
  reviewers: NonNullable<PullRequestInfo['reviewers']>;
}) {
  if (reviewers.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      {reviewers.slice(0, 6).map((r) => (
        <Tip
          key={r.identifier}
          label={`${r.displayName}: ${r.decision.replaceAll('-', ' ')}`}
        >
          <span className="relative">
            <Avatar name={r.displayName} size="xs" />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-2 ring-background',
                decisionDotClass(r.decision)
              )}
            />
          </span>
        </Tip>
      ))}
    </span>
  );
}

/** The unresolved-thread count, which opens the rail's comments at the
 *  first of them. */
function UnresolvedButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const label = `Show ${unresolvedCommentsLabel(count)}`;
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MessageSquareIcon className="size-3.5" />
        {count} unresolved
      </button>
    </Tip>
  );
}

export function PrHeader({
  pr,
  onShowUnresolved,
}: {
  pr: PullRequestInfo;
  onShowUnresolved: () => void;
}) {
  const reviewers = pr.reviewers ?? [];
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitPullRequestIcon className="size-4 shrink-0 text-info" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{pr.title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">#{pr.id}</span>
        <Tip label="Copy branch name">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(pr.sourceBranch);
              toast.success('Branch name copied');
            }}
            className="hidden min-w-0 items-center gap-1 truncate rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
          >
            <span className="truncate">
              {pr.sourceBranch} → {pr.targetBranch}
            </span>
            <CopyIcon className="size-3 shrink-0" />
          </button>
        </Tip>
      </span>

      <span className="mx-1 h-4 w-px shrink-0 bg-border" />

      {/* Never squeezed: the title truncates instead, and a cluster that
          shrinks wraps its counts onto a second line or runs under the
          buttons. */}
      <span className="flex shrink-0 items-center gap-2 text-sm whitespace-nowrap">
        <Tip label={`Opened by ${pr.createdByDisplayName}`}>
          <span className="flex items-center gap-1.5">
            <Avatar name={pr.createdByDisplayName} size="xs" />
            <span className="hidden truncate text-muted-foreground md:inline">
              {pr.createdByDisplayName}
            </span>
          </span>
        </Tip>
        {pr.isDraft && <Badge variant="outline">Draft</Badge>}
        <CiBadge ci={pr.buildStatus} />
        <ReviewerDots reviewers={reviewers} />
        {(pr.activeCommentCount ?? 0) > 0 && (
          <UnresolvedButton
            count={pr.activeCommentCount ?? 0}
            onClick={onShowUnresolved}
          />
        )}
      </span>

      <div className="flex-1" />

      <OpenInEditorButton branch={pr.sourceBranch} />
      <Tip label="Open on the provider">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.n10.openExternal(pr.url)}
        >
          <ExternalLinkIcon /> Open
        </Button>
      </Tip>
    </header>
  );
}

/** Header for a worktree tab without a PR: branch → base + files count. */
export function BranchHeader({
  branch,
  baseBranch,
  fileCount,
}: {
  branch: string;
  baseBranch: string;
  fileCount: number;
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
      <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 shrink items-center gap-2">
        <span className="truncate font-medium">{branch}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
          diff vs {baseBranch}
        </span>
      </span>
      <div className="flex-1" />
      <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
        {fileCount} file{fileCount === 1 ? '' : 's'} changed
      </span>
      <OpenInEditorButton branch={branch} />
    </header>
  );
}

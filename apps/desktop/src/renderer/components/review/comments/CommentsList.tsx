import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import type { CommentSeverity } from '../../../../host/contract.js';
import { cn } from '../../../lib/utils.js';
import { Avatar } from '../../ui/avatar.js';
import { SEVERITY_DOT } from '../../../lib/review/severity.js';

export interface CommentListItem {
  id: string;
  /** 'thread' = a real (remote) comment; 'draft' = an agent draft. */
  kind: 'thread' | 'draft';
  author: string;
  /** "file:line" or "Conversation" for general PR comments. */
  where: string;
  preview: string;
  resolved: boolean;
  severity?: CommentSeverity;
}

/**
 * Jump list of every comment on the PR — remote threads (inline +
 * general) and the agent's drafts — under the file tree. Click to
 * scroll the diff to it. Open items first; drafts flagged.
 */
export function CommentsList({
  items,
  activeId,
  open,
  onOpenChange,
  onJump,
  onContextMenu,
}: {
  items: CommentListItem[];
  activeId: string | null;
  /** Expanded. Owned by the workspace, which opens it from the header's
   *  unresolved count. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (item: CommentListItem) => void;
  /** Right-click a row: queue it for the agent (see PrWorkspace). */
  onContextMenu?: (item: CommentListItem) => void;
}) {
  if (items.length === 0) return null;
  const openCount = items.filter((i) => !i.resolved).length;
  const draftCount = items.filter((i) => i.kind === 'draft').length;

  return (
    <div className="flex min-h-0 flex-col border-t border-border">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronRightIcon className="size-3.5" />
        )}
        <MessageSquareIcon className="size-3.5" />
        Comments
        <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums">
          {draftCount > 0 && `${draftCount} draft · `}
          {openCount} open
        </span>
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              data-comment-row={item.id}
              aria-current={activeId === item.id || undefined}
              onClick={() => onJump(item)}
              onContextMenu={(e) => {
                if (!onContextMenu) return;
                e.preventDefault();
                onContextMenu(item);
              }}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent',
                activeId === item.id && 'bg-sidebar-active',
                item.resolved && 'opacity-60'
              )}
            >
              {item.kind === 'draft' ? (
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'size-2.5 rounded-full',
                      item.severity ? SEVERITY_DOT[item.severity] : 'bg-primary'
                    )}
                  />
                </span>
              ) : (
                <Avatar name={item.author} size="xs" className="mt-0.5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {item.kind === 'draft' ? (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <BotIcon className="size-3" /> Draft
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">
                      {item.author}
                    </span>
                  )}
                  <span className="truncate font-mono">{item.where}</span>
                  {item.resolved && (
                    <CheckCircle2Icon className="ml-auto size-3 shrink-0 text-success" />
                  )}
                </span>
                <span className="line-clamp-2 text-sm leading-snug">
                  {item.preview}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

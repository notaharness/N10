import { randomUUID } from 'node:crypto';
import { appendComment } from './comment-store.js';
import { resolveComment } from './conventional.js';
import type { CommentSeverity, ReviewComment } from './types.js';

const VALID_SEVERITIES = new Set<CommentSeverity>([
  'critical',
  'major',
  'minor',
  'nit',
]);

export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/s);
    if (match) {
      let value = match[2];
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
  }
  return result;
}

function handleAddComment(args: string[]): void {
  const parsed = parseArgs(args);

  const missing: string[] = [];
  for (const field of [
    'pr',
    'file',
    'lineStart',
    'lineEnd',
    'severity',
    'body',
  ]) {
    if (!parsed[field]) missing.push(field);
  }
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(', ')}`);
    console.error(
      'Usage: n10 util add-comment --pr=<id> --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body=<text> [--side=LEFT|RIGHT] [--thread=<id>]'
    );
    process.exit(1);
  }

  const severity = parsed.severity as CommentSeverity;
  if (!VALID_SEVERITIES.has(severity)) {
    console.error(
      `Invalid severity "${parsed.severity}". Must be: critical, major, minor, nit`
    );
    process.exit(1);
  }

  const side = (parsed.side as 'LEFT' | 'RIGHT') ?? 'RIGHT';
  if (side !== 'LEFT' && side !== 'RIGHT') {
    console.error('Invalid side. Must be LEFT or RIGHT');
    process.exit(1);
  }

  const prId = parseInt(parsed.pr, 10);
  if (isNaN(prId)) {
    console.error('--pr must be a number');
    process.exit(1);
  }

  const lineStart = parseInt(parsed.lineStart, 10);
  const lineEnd = parseInt(parsed.lineEnd, 10);
  if (isNaN(lineStart) || isNaN(lineEnd)) {
    console.error('--lineStart and --lineEnd must be numbers');
    process.exit(1);
  }

  const comment: ReviewComment = {
    id: randomUUID(),
    file: parsed.file,
    lineStart,
    lineEnd,
    // A body that opens with its own Conventional Comments header is
    // stating a severity too, and the two must not be able to
    // disagree — the louder wins. Settled once, here, so everything
    // that reads the stored draft (the walkthrough order, the rail
    // dot, the TUI chip, the posted body) says the same thing.
    severity: resolveComment(parsed.body, severity).severity,
    body: parsed.body,
    side,
    status: 'draft',
    createdAt: new Date().toISOString(),
    // Optional: the provider's id for the review thread this draft
    // answers. Recorded so the reader (and a later agent reading the
    // plan) can see which conversation the draft is about; posting
    // still opens a new thread at --file/--lineStart.
    ...(parsed.thread ? { threadId: parsed.thread } : {}),
  };

  appendComment(prId, comment);
  console.log(comment.id);
}

export async function handleUtilCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'add-comment') {
    handleAddComment(args.slice(1));
    return;
  }

  console.error(`Unknown util subcommand: ${subcommand}`);
  console.error('Available subcommands: add-comment');
  process.exit(1);
}

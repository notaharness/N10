import type { CeremonyOp } from '../../lib/fleet/ceremony-progress.js';
import {
  CREATE_FAILURE_NOTE,
  SAME_PASSKEY_NOTE,
  failureCopy,
  type NextAction,
} from '../../lib/fleet/ceremony-errors.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { Button } from '../ui/button.js';
import { PasskeyCompatibility } from './PasskeyCompatibility.js';

interface Handlers {
  retry?: () => void;
  back?: () => void;
  close: () => void;
}

const LABEL: Record<keyof Handlers, string> = {
  retry: 'Try again',
  back: 'Back',
  close: 'Close',
};

/** The actions to offer: the catalogue's that this surface can run,
 *  then Close, so no result is a dead end. */
function runnable(actions: NextAction[], handlers: Handlers) {
  const offered = actions.filter(
    (a): a is keyof Handlers => a !== 'compatibility' && !!handlers[a]
  );
  if (!offered.includes('back') && !offered.includes('close')) {
    offered.push('close');
  }
  return offered;
}

/**
 * A ceremony that ended in failure (beam-fleet-ux.md §4): what it means,
 * beam's exact code and its own detail, and only the next actions that
 * can run here. No link from the failed request stays on screen.
 */
export function CeremonyFailure({
  op,
  code,
  detail,
  reachedPasskey = false,
  handlers,
}: {
  op: CeremonyOp;
  code: string;
  detail: string | null;
  /** The ceremony got as far as offering a passkey link. */
  reachedPasskey?: boolean;
  handlers: Handlers;
}) {
  const copy = failureCopy(code);
  const focus = useFocusOnMount<HTMLDivElement>();
  return (
    <div className="space-y-3">
      <div
        ref={focus}
        tabIndex={-1}
        role="alert"
        className="space-y-2 text-sm outline-none"
      >
        <p className="text-destructive">{copy.explanation}</p>
        {op === 'init' && reachedPasskey && <p>{CREATE_FAILURE_NOTE}</p>}
        {op !== 'init' && code === 'prf-unsupported' && (
          <p>{SAME_PASSKEY_NOTE}</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Error code{' '}
        <code className="font-mono text-foreground select-all">{code}</code>
      </p>
      {detail && (
        <p className="font-mono text-xs break-words text-muted-foreground select-text">
          {detail}
        </p>
      )}
      {copy.actions.includes('compatibility') && (
        <PasskeyCompatibility defaultOpen />
      )}
      <div className="flex gap-2">
        {runnable(copy.actions, handlers).map((a, i) => (
          <Button
            key={a}
            size="sm"
            variant={i === 0 ? 'default' : 'outline'}
            onClick={handlers[a]}
          >
            {LABEL[a]}
          </Button>
        ))}
      </div>
    </div>
  );
}

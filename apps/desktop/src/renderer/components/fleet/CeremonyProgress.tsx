import { CheckIcon, CircleIcon, LoaderIcon, XIcon } from 'lucide-react';
import {
  INIT_STEPS,
  ceremonyHeading,
  initStepStatuses,
  pastPasskeys,
  type CeremonyView,
  type StepStatus,
} from '../../lib/fleet/ceremony-progress.js';
import { useFocusOnMount } from '../../lib/fleet/use-focus-on-mount.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';
import { PasskeyPrompt } from './PasskeyPrompt.js';

const STEP_ICON: Record<StepStatus, typeof CheckIcon> = {
  pending: CircleIcon,
  active: LoaderIcon,
  done: CheckIcon,
  failed: XIcon,
};

const STEP_WORD: Record<StepStatus, string> = {
  pending: 'not started',
  active: 'in progress',
  done: 'done',
  failed: 'stopped',
};

/** A fleet's two passkey prompts, each pending, active, done or failed:
 *  no percentage, and no check on the step a failure stopped on. */
export function InitSteps({
  view,
  failed = false,
}: {
  view: CeremonyView;
  failed?: boolean;
}) {
  const statuses = initStepStatuses(view, failed);
  return (
    <ol className="space-y-1 text-sm">
      {INIT_STEPS.map((step, i) => {
        const status = statuses[i];
        const Icon = STEP_ICON[status];
        return (
          <li
            key={step}
            aria-current={status === 'active' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2',
              status === 'pending' && 'text-muted-foreground',
              status === 'failed' && 'text-destructive'
            )}
          >
            <Icon
              aria-hidden
              className={cn('size-3.5', status === 'active' && 'animate-spin')}
            />
            <span>
              {i + 1}. {step}
              <span className="sr-only"> ({STEP_WORD[status]})</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A running ceremony: its steps for a fleet's creation, what it is
 * doing now, and while beam waits on a passkey, that step's link.
 * `cancelLabel` names the explicit cancel, which waits for beam.
 */
export function CeremonyProgress({
  view,
  cancelLabel,
  onCancel,
}: {
  view: CeremonyView;
  cancelLabel: string;
  onCancel: () => void;
}) {
  const { heading, explanation } = ceremonyHeading(view);
  const focus = useFocusOnMount<HTMLHeadingElement>();
  // Past the passkey steps there is nothing left to cancel.
  const cancellable = !pastPasskeys(view);
  return (
    <div className="space-y-4">
      {view.op === 'init' && <InitSteps view={view} />}
      <div role="status" aria-live="polite" className="space-y-1">
        <h3 ref={focus} tabIndex={-1} className="font-medium outline-none">
          {heading}
        </h3>
        {explanation && (
          <p className="text-sm text-muted-foreground">{explanation}</p>
        )}
      </div>
      {view.passkeyUrl && !view.cancelling && (
        <PasskeyPrompt url={view.passkeyUrl} />
      )}
      {cancellable && (
        <Button
          size="sm"
          variant="ghost"
          disabled={view.cancelling}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      )}
    </div>
  );
}

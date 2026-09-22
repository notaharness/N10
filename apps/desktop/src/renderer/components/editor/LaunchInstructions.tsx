import type { SessionLaunchView } from '../../../host/contract.js';
import { Label } from '../ui/label.js';
import { Textarea } from '../ui/textarea.js';

export function ReviewInstructions({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <p className="text-muted-foreground">
        Review this pull request. The review runs in a session of its own, so an
        agent working on this branch carries on. Comments appear as drafts for
        you to edit and post.
      </p>
      <div className="space-y-2">
        <Label htmlFor="review-instructions">
          Additional instructions{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="review-instructions"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Focus on module boundaries and public APIs…"
          className="min-h-24"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </div>
    </>
  );
}
export function ReplacementNotice({ info }: { info?: SessionLaunchView }) {
  return (
    <p role="note" className="border-l-2 border-primary bg-primary/10 p-3">
      This stops the running {info?.recordedAgentName ?? 'agent'} session and
      starts a new conversation in this worktree.
    </p>
  );
}

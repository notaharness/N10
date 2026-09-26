import { useFleet } from '../../lib/fleet/fleet-context.js';
import { nameError } from '../../lib/fleet/names.js';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { PasskeyCompatibility } from './PasskeyCompatibility.js';

function Choices({ disabled }: { disabled: boolean }) {
  const { choose } = useFleet().enrolment;
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Connect your first machine</h2>
      <p className="text-sm text-muted-foreground">
        Create a fleet once. On your other machines, join it with the same
        passkey. Members can run commands as your user unless you restrict their
        access.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => choose('create')}>
          Create a fleet
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => choose('join')}
        >
          Join an existing fleet
        </Button>
      </div>
    </div>
  );
}

function NameField({
  id,
  label,
  placeholder,
  value,
  onChange,
  helper,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
}) {
  const error = nameError(value);
  const describedBy = error
    ? `${id}-error`
    : helper
    ? `${id}-helper`
    : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p
          id={`${id}-error`}
          aria-live="polite"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : (
        helper && (
          <p id={`${id}-helper`} className="text-sm text-muted-foreground">
            {helper}
          </p>
        )
      )}
    </div>
  );
}

function CreateSteps() {
  return (
    <div className="space-y-2 text-sm">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Create your fleet passkey — save a new passkey for beam.n10.is.</li>
        <li>
          Authorize this machine — use that same passkey to sign its membership
          and unlock the encrypted directory.
        </li>
      </ol>
      <p className="text-muted-foreground">
        Two passkey prompts, once per fleet. Each prompt has its own link and QR
        code.
      </p>
    </div>
  );
}

/** Create or join: the names, what the passkey steps will be, and the
 *  compatibility help, before anything starts (beam-fleet-ux.md §2). */
function EnrolmentForm({ disabled }: { disabled: boolean }) {
  const e = useFleet().enrolment;
  const creating = e.mode === 'create';
  const invalid =
    nameError(e.label) !== null ||
    (creating && nameError(e.fleetName) !== null);
  return (
    <form
      className="space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        e.submit();
      }}
    >
      <h2 className="text-sm font-semibold">
        {creating ? 'Create a fleet' : 'Join an existing fleet'}
      </h2>
      {!creating && (
        <p className="text-sm text-muted-foreground">
          Use the passkey you created for this fleet. One passkey prompt
          authorizes this machine.
        </p>
      )}
      <div className="grid gap-3">
        <NameField
          id="beam-label"
          label="This machine’s name"
          placeholder="Host name"
          value={e.label}
          onChange={e.setLabel}
        />
        {creating && (
          <NameField
            id="beam-fleet-name"
            label="Fleet name"
            placeholder="beam"
            value={e.fleetName}
            onChange={e.setFleetName}
            helper="The fleet name appears in your passkey manager."
          />
        )}
      </div>
      {creating && <CreateSteps />}
      <PasskeyCompatibility />
      <div className="flex gap-2">
        <Button type="submit" disabled={invalid || disabled}>
          {creating ? 'Create fleet' : 'Join fleet'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => e.choose(null)}>
          Back
        </Button>
      </div>
    </form>
  );
}

/** An unenrolled machine's way in: two choices, then that choice's form. */
export function FirstRun({ disabled }: { disabled: boolean }) {
  const { mode } = useFleet().enrolment;
  return mode ? (
    <EnrolmentForm disabled={disabled} />
  ) : (
    <Choices disabled={disabled} />
  );
}

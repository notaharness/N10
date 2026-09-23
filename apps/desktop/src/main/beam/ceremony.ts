import type {
  CeremonyOutcome,
  CeremonyProgress,
  CeremonyRequest,
} from '../../host/contract-machines.js';
import { BeamOpError, ControlConnection } from './control.js';

/** What each failure tells the owner, in beam docs/07's and docs/08's
 *  words where they have some. */
const FAILURES: Record<string, string> = {
  'prf-unsupported':
    "This passkey provider doesn't support what beam needs; try another.",
  'directory-unavailable': 'Directory unavailable; try again.',
  'wrong-passkey': 'That passkey is not the one this fleet was created with.',
  'ceremony-timeout': 'The passkey step timed out.',
  'ceremony-cancelled': 'Cancelled.',
  'ceremony-state': 'The ceremony answer did not match; start again.',
  busy: 'Another passkey ceremony is already under way.',
  'already-enrolled': 'This machine is already in a fleet.',
  'bad-assertion': 'The passkey answer did not verify.',
  'revoked-peer': 'This machine has been revoked from the fleet.',
};

function failure(err: unknown): CeremonyOutcome {
  if (err instanceof BeamOpError) {
    return {
      ok: false,
      code: err.code,
      message: FAILURES[err.code] ?? err.message,
    };
  }
  return {
    ok: false,
    code: 'internal',
    message: err instanceof Error ? err.message : String(err),
  };
}

function startFields(request: CeremonyRequest): Record<string, unknown> {
  switch (request.op) {
    case 'init':
      return { label: request.label, fleetName: request.fleetName };
    case 'join':
      return { label: request.label };
    case 'revoke':
      return { peer: request.peerId };
  }
}

interface WaitResult {
  peerId?: string;
  fleetId?: string;
  members?: number;
  published?: unknown;
  acknowledgedBy?: number;
}

function outcome(request: CeremonyRequest, r: WaitResult): CeremonyOutcome {
  const published = r.published === true;
  switch (request.op) {
    case 'init':
      return {
        ok: true,
        op: 'init',
        fleetId: r.fleetId ?? '',
        peerId: r.peerId ?? '',
        published,
      };
    case 'join':
      return {
        ok: true,
        op: 'join',
        fleetId: r.fleetId ?? '',
        members: r.members ?? 0,
        published,
      };
    case 'revoke':
      return {
        ok: true,
        op: 'revoke',
        published,
        acknowledgedBy: r.acknowledgedBy ?? 0,
      };
  }
}

function asString(data: unknown, key: string): string | null {
  const value = (data as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

/**
 * One ceremony on its own connection, as the beam CLI runs one
 * (beam docs/06, Ceremonies): `<op>.start`, then `<op>.wait`, whose
 * connection alone hears the flow's `ceremony` and `stage` events. The
 * first passkey step creates the credential for `init` and signs for
 * everything else; a second `ceremony` event is always a signature.
 *
 * `signal` cancels it. `ceremony.cancel` ends only a flow that exists,
 * and the start can take seconds before it makes one, so a cancel
 * during the start is sent once the start answers.
 */
export async function runCeremony(
  socketPath: string,
  request: CeremonyRequest,
  onProgress: (progress: CeremonyProgress) => void,
  signal: AbortSignal
): Promise<CeremonyOutcome> {
  let conn: ControlConnection | null = null;
  try {
    const c = (conn = await ControlConnection.connect(socketPath));
    onProgress({ kind: 'stage', stage: 'preparing network' });
    const start = await c.request<{ ceremonyUrl: string }>(
      `${request.op}.start`,
      startFields(request)
    );
    const cancel = () => c.request('ceremony.cancel').catch(() => undefined);
    if (signal.aborted) {
      await cancel();
      return failure(new BeamOpError('ceremony-cancelled', ''));
    }
    signal.addEventListener('abort', () => void cancel(), { once: true });
    onProgress({
      kind: 'passkey',
      step: request.op === 'init' ? 'create' : 'sign',
      ceremonyUrl: start.ceremonyUrl,
    });
    c.onEvent((event, data) => {
      const url = asString(data, 'ceremonyUrl');
      const stage = asString(data, 'stage');
      if (event === 'ceremony' && url) {
        onProgress({ kind: 'passkey', step: 'sign', ceremonyUrl: url });
      } else if (event === 'stage' && stage) {
        onProgress({ kind: 'stage', stage });
      }
    });
    return outcome(request, await c.request<WaitResult>(`${request.op}.wait`));
  } catch (err) {
    return failure(err);
  } finally {
    conn?.close();
  }
}

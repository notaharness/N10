import type { CeremonyRequest } from '../../../host/contract-machines.js';
import type { CeremonyView } from './ceremony-model.js';

export function ceremonyHeading(
  view: CeremonyView,
  operation: CeremonyRequest['op']
): string {
  if (!view.passkeyUrl) {
    const stage = view.stages.at(-1);
    if (stage === 'reading directory') return 'Reading fleet directory…';
    if (stage === 'publishing') return 'Publishing membership…';
    return 'Preparing network…';
  }
  if (operation === 'revoke') return 'Authorize revocation';
  if (operation === 'join') return 'Authorize this machine';
  return view.stages.includes('waiting for your passkey (sign)')
    ? 'Step 2 of 2 · Authorize this machine'
    : 'Step 1 of 2 · Create your fleet passkey';
}

export function ceremonyExplanation(
  view: CeremonyView,
  operation: CeremonyRequest['op']
): string {
  if (!view.passkeyUrl)
    return 'beam is completing this request on your machine.';
  if (operation === 'revoke')
    return 'Use your fleet’s passkey to sign the permanent revocation.';
  if (operation === 'join')
    return 'Choose this fleet’s existing passkey. Do not create another passkey.';
  return view.stages.includes('waiting for your passkey (sign)')
    ? 'Use the passkey you just created. This signs this machine’s membership and derives the key for the encrypted directory. Scan this new QR code if you are using a phone.'
    : 'Save a new passkey for beam.n10.is. Then return here for the second prompt.';
}

export function ceremonyTarget(
  url: string
): { label: string; fingerprint: string; action: string } | null {
  try {
    const p = new URLSearchParams(new URL(url).hash.slice(1));
    const label = p.get('l');
    const fingerprint = p.get('f');
    if (!label || !fingerprint || !/^[a-f0-9]{16}$/.test(fingerprint))
      return null;
    const action = (
      { c: 'Create fleet', a: 'Add machine', r: 'Remove machine' } as Record<
        string,
        string
      >
    )[p.get('o') ?? ''];
    return action ? { label, fingerprint, action } : null;
  } catch {
    return null;
  }
}

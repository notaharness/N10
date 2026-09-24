import { ChevronRightIcon } from 'lucide-react';
import { openLink } from '../../lib/open-link.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible.js';

/** What vendors document about PRF, per layer (beam-fleet-ux.md §7).
 *  Documentation, not a tested matrix: nothing here is promised. */
const LAYERS: {
  layer: string;
  note: string;
  unverified?: string;
  source?: string;
}[] = [
  {
    layer: 'Safari / WebKit',
    note: 'For this page use Safari 18.4 or later. Safari 18.0 PRF support alone is insufficient.',
    source: 'https://webkit.org/blog/16574/webkit-features-in-safari-18-4/',
  },
  {
    layer: 'Apple Passwords / iCloud Keychain',
    note: 'Use updated Apple software. iOS/iPadOS 18.4+ with Safari 18.4+ is the page’s practical baseline; macOS Safari 18.4+ also needs a compatible provider.',
    unverified:
      'The oldest supported macOS and provider pairing, and whether Apple’s fix for phone-assisted sign-in has shipped.',
    source: 'https://developer.apple.com/forums/thread/764730',
  },
  {
    layer: 'Firefox desktop',
    note: 'Firefox 139+ on desktop has the browser features. Your passkey provider must still supply PRF.',
    unverified: 'Firefox on Android and iOS.',
    source:
      'https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139',
  },
  {
    layer: 'Chrome',
    note: 'Chrome 133+ meets the encryption baseline. PRF must still be confirmed for your provider.',
    unverified:
      'Chrome’s first PRF release, and Google Password Manager support by operating system and version.',
    source: 'https://developer.chrome.com/release-notes/133',
  },
  {
    layer: '1Password for iOS',
    note: '1Password for iOS 8.10.74+ adds provider PRF support on iOS 18. This page also needs Safari/iOS 18.4+ for X25519.',
    source:
      'https://releases.1password.com/ios/stable/#1password-for-ios-8.10.74',
  },
  {
    layer:
      '1Password browser extension (beta 2.26.1) and Android (beta 8.10.38)',
    note: 'PRF was introduced in these beta versions; earliest stable versions are unverified here. Update your provider and use the result check.',
    source: 'https://1password.com/blog/encrypt-data-saved-passkeys',
  },
  {
    layer: 'YubiKey',
    note: 'Use a PRF-capable FIDO2 key with a browser/OS that exposes it. A key supporting hmac-secret alone does not guarantee WebAuthn PRF.',
    unverified: 'Minimum firmware and operating system versions.',
    source:
      'https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html',
  },
  {
    layer: 'Windows Hello',
    note: 'Unverified. Browser support does not mean Windows Hello supports it.',
  },
  {
    layer: 'Bitwarden, Proton Pass and other providers',
    note: 'Unverified. Ability to unlock that provider’s own vault using PRF does not prove it returns PRF for beam credentials.',
  },
  {
    layer: 'Edge, Samsung Internet',
    note: 'Unverified. Chrome’s version numbers do not carry over; the page checks at run time.',
  },
];

/** **Passkey compatibility**, closed until asked for, or open where a
 *  PRF failure sends the owner to it. */
export function PasskeyCompatibility({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/compat text-sm">
      <CollapsibleTrigger className="flex items-center gap-1 font-medium hover:underline">
        <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]/compat:rotate-90" />
        Passkey compatibility
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3 text-muted-foreground">
        <p>
          beam needs WebAuthn PRF, not just ordinary passkeys. PRF derives the
          key that encrypts your fleet directory. Support depends on the
          browser, operating system, passkey provider and sometimes the way a
          security key connects. The ceremony page checks browser capabilities,
          then verifies the selected passkey result.
        </p>
        <p>
          What follows is what vendors document, not combinations tested end to
          end.
        </p>
        <dl className="space-y-2">
          {LAYERS.map((l) => (
            <div key={l.layer}>
              <dt className="font-medium text-foreground">{l.layer}</dt>
              <dd>
                {l.note} {l.unverified && <>Unverified: {l.unverified} </>}
                {l.source && (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    aria-label={`Source for ${l.layer}`}
                    onClick={() => openLink(l.source!)}
                  >
                    Source
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

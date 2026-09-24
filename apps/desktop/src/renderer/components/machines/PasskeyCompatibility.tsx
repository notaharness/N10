import { toast } from 'sonner';

const SOURCES = [
  [
    'WebKit: Safari 18.4',
    'https://webkit.org/blog/16574/webkit-features-in-safari-18-4/',
  ],
  [
    'Mozilla: Firefox 139',
    'https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139',
  ],
  ['Chrome 133', 'https://developer.chrome.com/release-notes/133'],
  ['1Password iOS releases', 'https://releases.1password.com/ios/stable/'],
] as const;

export function PasskeyCompatibility({
  expanded = false,
}: {
  expanded?: boolean;
}) {
  return (
    <details
      open={expanded || undefined}
      className="rounded-md border border-border p-3 text-sm"
    >
      <summary className="cursor-pointer font-medium">
        Passkey compatibility
      </summary>
      <div className="mt-3 space-y-3 text-muted-foreground">
        <p>
          beam needs WebAuthn PRF, not just ordinary passkeys. PRF derives the
          key that encrypts your fleet directory. Browser, operating system and
          passkey provider must all support it.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Safari: PRF arrived in 18.0, but this page needs Safari 18.4+ for
            X25519 encryption. On iPhone or iPad, use OS 18.4+.
          </li>
          <li>
            Firefox 139+ on desktop has the browser features. The selected
            passkey provider must still supply PRF.
          </li>
          <li>
            Chrome 133+ meets the X25519 encryption baseline. Google Password
            Manager’s exact OS/version support is unverified here; the ceremony
            checks the result.
          </li>
          <li>
            1Password for iOS 8.10.74+ adds PRF on iOS 18. This page also needs
            Safari/iOS 18.4+ for encryption.
          </li>
          <li>
            Apple Passwords, hardware keys and other providers depend on the OS
            and connection method. Exact minimum versions for Windows Hello,
            Bitwarden, Proton Pass, Edge and Samsung Internet are unverified
            here.
          </li>
        </ul>
        <p>
          The external browser checks its capabilities. That check cannot
          guarantee your selected provider supports PRF. For an existing fleet,
          keep using its original passkey.
        </p>
        <div className="flex flex-wrap gap-3">
          {SOURCES.map(([label, url]) => (
            <button
              type="button"
              key={url}
              className="text-primary underline"
              onClick={() =>
                window.n10
                  .openExternal(url)
                  .catch(() => toast.error('Could not open the source'))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

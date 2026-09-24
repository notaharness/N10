import { toast } from 'sonner';

/** Opens `url` in the system browser, saying so if it cannot. */
export function openLink(url: string): void {
  window.n10
    .openExternal(url)
    .catch(() => toast.error('Could not open the browser'));
}

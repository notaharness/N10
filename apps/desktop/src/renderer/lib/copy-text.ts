import { toast } from 'sonner';

/** Copies `text`, toasting `copied` or that it could not. */
export function copyText(text: string, copied: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(copied),
    () => toast.error('Could not copy to the clipboard')
  );
}

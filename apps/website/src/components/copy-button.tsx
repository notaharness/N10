'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const FEEDBACK_MS = 1600;

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  /** Accessible name, e.g. "Copy the desktop app install command". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function copy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
      },
      // Clipboard access denied (permissions policy, insecure origin):
      // the command is still selectable text, so stay quiet.
      () => setCopied(false)
    );
  }

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className={cn(
        'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground focus-visible:ring-fd-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2',
        copied && 'text-fd-primary hover:text-fd-primary',
        className
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

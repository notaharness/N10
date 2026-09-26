import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind-aware className combiner (shadcn convention). Copied
 * verbatim from apps/desktop/src/renderer/lib/utils.ts — see
 * src/app/global.css for why this stays a copy rather than a shared
 * import.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

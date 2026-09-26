import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

// Adapted from apps/desktop/src/renderer/components/ui/button.tsx onto
// Fumadocs' --color-fd-* token namespace instead of shadcn's — see
// src/app/global.css for why this is a copy, not a shared import.
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-fd-primary/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-fd-primary text-fd-primary-foreground hover:bg-fd-primary/90',
        outline:
          'border border-fd-border bg-transparent hover:bg-fd-accent hover:text-fd-accent-foreground',
        ghost: 'hover:bg-fd-accent hover:text-fd-accent-foreground',
      },
      size: {
        default: 'h-10 px-5 text-sm',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };

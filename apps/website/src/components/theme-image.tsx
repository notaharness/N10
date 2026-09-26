import { cn } from '@/lib/cn';

/**
 * A screenshot in the site's current theme. Both images render and CSS
 * hides one by the `.dark` class next-themes sets, so the image follows
 * the theme toggle rather than the OS setting.
 */
export function ThemeImage({
  name,
  alt,
  className,
}: {
  name: string;
  alt: string;
  className?: string;
}) {
  return (
    <>
      <img
        src={`/media/${name}-light.webp`}
        alt={alt}
        className={cn(className, 'n10-only-light')}
      />
      <img
        src={`/media/${name}.webp`}
        alt=""
        aria-hidden
        className={cn(className, 'n10-only-dark')}
      />
    </>
  );
}

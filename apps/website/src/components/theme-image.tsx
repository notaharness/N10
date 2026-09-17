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
    <picture>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={`/media/${name}.webp`}
      />
      <source
        media="(prefers-color-scheme: light)"
        srcSet={`/media/${name}-light.webp`}
      />
      <img src={`/media/${name}.webp`} alt={alt} className={className} />
    </picture>
  );
}

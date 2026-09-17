export function DemoVideo({
  name,
  alt,
  className,
}: {
  name: string;
  alt: string;
  className?: string;
}) {
  return (
    <video
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="none"
      poster={`/media/${name}-poster.webp`}
      aria-label={alt}
    >
      <source src={`/media/${name}.webm`} type="video/webm" />
      <source src={`/media/${name}.mp4`} type="video/mp4" />
    </video>
  );
}

import { DemoVideo } from '@/components/demo-video';

export interface Feature {
  media: string;
  title: string;
  description: string;
}

export function FeatureSection({
  media,
  title,
  description,
  reverse,
}: Feature & { reverse: boolean }) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-2">
      <div className={reverse ? 'md:order-2' : undefined}>
        <h3 className="text-2xl font-semibold">{title}</h3>
        <p className="text-fd-muted-foreground mt-3">{description}</p>
      </div>
      <DemoVideo
        name={media}
        alt={title}
        className="w-full rounded-lg border border-fd-border shadow-sm"
      />
    </div>
  );
}

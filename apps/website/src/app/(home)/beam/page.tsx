import type { Metadata } from 'next';
import { BeamCta } from '@/components/beam/beam-cta';
import { BeamHero } from '@/components/beam/beam-hero';
import { BeamHow } from '@/components/beam/beam-how';
import { BeamNotes } from '@/components/beam/beam-notes';
import { BeamOverviewDiagram } from '@/components/beam/beam-overview-diagram';
import { BeamQueueDiagram } from '@/components/beam/beam-queue-diagram';
import { BeamStreams } from '@/components/beam/beam-streams';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Beam',
  description:
    'Pool the machines you own into a fleet and open shells, run commands and leave durable messages between them; n10 and Orchestra use Beam to run agents on another machine.',
};

export default function BeamPage() {
  return (
    <main className="flex flex-1 flex-col">
      <BeamHero />
      <BeamHow />
      <div className="px-4">
        <BeamOverviewDiagram />
      </div>
      <BeamStreams />
      <div className="px-4">
        <BeamQueueDiagram />
      </div>
      <BeamNotes />
      <BeamCta />
      <Footer />
    </main>
  );
}

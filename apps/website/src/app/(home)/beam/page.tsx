import type { Metadata } from 'next';
import { BeamCta } from '@/components/beam/beam-cta';
import { BeamHero } from '@/components/beam/beam-hero';
import { BeamHow } from '@/components/beam/beam-how';
import { BeamNotes } from '@/components/beam/beam-notes';
import { BeamStreams } from '@/components/beam/beam-streams';
import { Footer } from '@/components/landing/footer';

export const metadata: Metadata = {
  title: 'Beam',
  description:
    'Pair two machines and run terminals, commands and messages between them — the transport n10 and Orchestra use to run agents on another machine.',
};

export default function BeamPage() {
  return (
    <main className="flex flex-1 flex-col">
      <BeamHero />
      <BeamHow />
      <BeamStreams />
      <BeamNotes />
      <BeamCta />
      <Footer />
    </main>
  );
}

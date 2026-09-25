import { Cta } from '@/components/landing/cta';
import { Features } from '@/components/landing/features';
import { FleetSection } from '@/components/landing/fleet-section';
import { Footer } from '@/components/landing/footer';
import { Hero } from '@/components/landing/hero';
import { InstallStrip } from '@/components/landing/install-strip';
import { LoopSection } from '@/components/landing/loop-section';
import { ProvidersTable } from '@/components/landing/providers-table';
import { TmuxSection } from '@/components/landing/tmux-section';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <InstallStrip />
      <LoopSection />
      <TmuxSection />
      <Features />
      <FleetSection />
      <ProvidersTable />
      <Cta />
      <Footer />
    </main>
  );
}

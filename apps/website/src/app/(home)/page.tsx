import { Cta } from '@/components/landing/cta';
import { Features } from '@/components/landing/features';
import { Footer } from '@/components/landing/footer';
import { Hero } from '@/components/landing/hero';
import { InstallStrip } from '@/components/landing/install-strip';
import { ProvidersTable } from '@/components/landing/providers-table';
import { TerminalUiSection } from '@/components/landing/terminal-ui';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <Hero />
      <InstallStrip />
      <Features />
      <TerminalUiSection />
      <ProvidersTable />
      <Cta />
      <Footer />
    </main>
  );
}

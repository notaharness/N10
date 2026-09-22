import type { Metadata } from 'next';
import { Footer } from '@/components/landing/footer';
import { OrchestraHero } from '@/components/orchestra/orchestra-hero';
import { OrchestraInstall } from '@/components/orchestra/orchestra-install';
import { OrchestraReports } from '@/components/orchestra/orchestra-reports';
import { OrchestraTags } from '@/components/orchestra/orchestra-tags';

export const metadata: Metadata = {
  title: 'Orchestra',
  description:
    'A pair of skills that let one coding agent conduct others: each player works a branch in its own tmux session and Git worktree and reports back. Shares its session tags with n10 and runs players on other machines over Beam.',
};

export default function OrchestraPage() {
  return (
    <main className="flex flex-1 flex-col">
      <OrchestraHero />
      <OrchestraReports />
      <OrchestraTags />
      <OrchestraInstall />
      <Footer />
    </main>
  );
}

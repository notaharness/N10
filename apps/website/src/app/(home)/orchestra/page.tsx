import type { Metadata } from 'next';
import { Footer } from '@/components/landing/footer';
import { OrchestraAttention } from '@/components/orchestra/orchestra-attention';
import { OrchestraHero } from '@/components/orchestra/orchestra-hero';
import { OrchestraInstall } from '@/components/orchestra/orchestra-install';
import { OrchestraReports } from '@/components/orchestra/orchestra-reports';
import { OrchestraTags } from '@/components/orchestra/orchestra-tags';

export const metadata: Metadata = {
  title: 'Orchestra',
  description:
    'Two skills that let one coding agent delegate branch-sized tasks to agents in separate tmux sessions and Git worktrees. Orchestra shares session tags with n10 and can run players on machines in your Beam fleet.',
};

export default function OrchestraPage() {
  return (
    <main className="flex flex-1 flex-col">
      <OrchestraHero />
      <OrchestraReports />
      <OrchestraAttention />
      <OrchestraTags />
      <OrchestraInstall />
      <Footer />
    </main>
  );
}

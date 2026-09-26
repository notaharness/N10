import type { Metadata } from 'next';
import { LogoLab } from '@/components/logo-lab';

/** Design scratch page for choosing the mark's colours and motion. */
export const metadata: Metadata = {
  title: 'Logo lab',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <LogoLab />;
}

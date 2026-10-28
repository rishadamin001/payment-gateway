import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PayBD Demo | Simulated Bangladesh payments',
  description: 'A simulated Bangladesh payment gateway for MIS465. Explore payment requests and their history. DEMO MODE: no real money.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}

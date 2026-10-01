import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';

const sans = Archivo({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Logic Lanes', template: '%s · Logic Lanes' },
  description:
    'Smart logistics for India: automated cargo matching that fills empty return trips, live AI rerouting and digital Job Cards.',
};

export const viewport: Viewport = {
  themeColor: '#122C4F',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}

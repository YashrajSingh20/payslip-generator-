import { Geist_Mono, Instrument_Serif, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
const display = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });

export const metadata = {
  title: 'Keystone Payroll',
  description: 'Payroll runs and payslips for Keystone Commerce',
  manifest: '/manifest.json',
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: '#2a160c',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}

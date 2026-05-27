import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI TradeVision PRO — Dr. Strange',
  description: 'Institutional AI Predictive Trading Terminal',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

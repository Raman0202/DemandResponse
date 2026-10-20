import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GNA (Demand Response)',
  description: 'Automated Demand Response Management System — SLDC console and industry portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#070d18' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}

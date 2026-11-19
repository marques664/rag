import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/providers/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enterprise Knowledge AI',
  description:
    'Multi-tenant RAG knowledge workspace with verifiable citations, asynchronous PDF ingestion, and tenant isolation.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

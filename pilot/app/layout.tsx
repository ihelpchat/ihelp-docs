import { Inter, JetBrains_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ihelp-sans',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-ihelp-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ajuda.ihelpchat.com'),
  title: {
    default: 'Central de ajuda iHelp',
    template: '%s | iHelp',
  },
  description: 'Respostas, tutoriais e referência técnica para usar o iHelp.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jetBrainsMono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}

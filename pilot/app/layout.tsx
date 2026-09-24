import { Inter, JetBrains_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { SiteShell } from '@/components/site/shell';
import { getNavGroups, getScopeCounts, getSiteCounts } from '@/lib/site';
import { AssistantProvider } from '@/components/assistant/assistant-context';
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
  metadataBase: new URL('https://faq.ihelpchat.com/ihelp-docs/'),
  title: {
    default: 'Central de ajuda iHelp',
    template: '%s | iHelp',
  },
  description: 'Respostas, tutoriais e referência técnica para usar o iHelp.',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jetBrainsMono.variable}`} suppressHydrationWarning>
      <body>
        <AssistantProvider counts={getScopeCounts()}>
          <Provider counts={getSiteCounts()}>
            <SiteShell docs={getNavGroups('docs')} api={getNavGroups('api')}>{children}</SiteShell>
          </Provider>
        </AssistantProvider>
      </body>
    </html>
  );
}

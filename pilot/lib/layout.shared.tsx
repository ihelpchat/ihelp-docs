import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Headphones } from 'lucide-react';
import Image from 'next/image';
import { withBasePath } from '@/lib/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="brand-lockup">
          <Image src={withBasePath('/img/logo.svg')} alt="iHelp" width={58} height={24} priority />
          <span>documentação</span>
        </span>
      ),
    },
    links: [
      { text: 'Central de ajuda', url: '/docs', active: 'nested-url' },
      { text: 'Tutoriais', url: '/tutoriais', active: 'nested-url' },
      { text: 'Referência da API', url: '/api', active: 'nested-url' },
      { text: 'Novidades', url: '/blog', active: 'nested-url' },
      {
        type: 'button',
        text: 'Falar com o suporte',
        icon: <Headphones aria-hidden="true" />,
        url: 'https://wa.me/551730422307',
        external: true,
        secondary: true,
      },
    ],
    themeSwitch: { enabled: false },
  };
}

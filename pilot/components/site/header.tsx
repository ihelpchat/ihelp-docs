'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, X, Zap } from 'lucide-react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { withBasePath } from '@/lib/shared';
import { supportUrl } from '@/lib/links';

const nav = [
  { label: 'Central de ajuda', href: '/docs' },
  { label: 'Tutoriais', href: '/tutoriais' },
  { label: 'Referência da API', href: '/api' },
  { label: 'Novidades', href: '/blog' },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader({ menuOpen, onMenu }: { menuOpen?: boolean; onMenu?: () => void }) {
  const pathname = usePathname();
  const { setOpenSearch } = useSearchContext();
  const dark = isActive(pathname, '/api');

  return (
    <header className={dark ? 'ih-header ih-header-dark' : 'ih-header'}>
      <div className="ih-header-inner">
        <Link href="/" className="ih-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath(dark ? '/brand/logo-lockup-light-on-dark.svg' : '/brand/logo-lockup.svg')} alt="iHelp" width={51} height={22} />
          {dark ? <span className="ih-brand-tag">API</span> : <span className="ih-brand-label">documentação</span>}
        </Link>
        <nav className="ih-nav" aria-label="Seções">
          {nav.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className={`ih-nav-link${index % 2 === 1 ? ' ih-nav-extra' : ''}`}
              data-active={isActive(pathname, item.href) || (pathname === '/' && item.href === '/docs') || undefined}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button type="button" className="ih-header-search" onClick={() => setOpenSearch(true)}>
          <Search aria-hidden="true" />
          <span>{dark ? 'Buscar na documentação' : 'Buscar ou perguntar'}</span>
          <kbd>⌘K</kbd>
        </button>
        {dark ? (
          <Link href="/api/conceitos/obter-token" className="ih-header-cta ih-header-cta-primary">
            <Zap aria-hidden="true" />
            Pegar meu token
          </Link>
        ) : (
          <a href={supportUrl} className="ih-header-cta" target="_blank" rel="noreferrer noopener">
            Falar com o suporte
          </a>
        )}
        {onMenu ? (
          <button type="button" className="ih-menu-button" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} onClick={onMenu}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        ) : null}
      </div>
    </header>
  );
}

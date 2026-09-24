'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { SiteHeader, isActive } from '@/components/site/header';
import { Sidebar } from '@/components/site/sidebar';
import type { NavGroup } from '@/lib/site';
import { AssistantDrawer, AssistantLauncher } from '@/components/assistant/assistant-drawer';
import { assistantEnabled } from '@/lib/assistant';

const sections = [
  { label: 'Claricia', href: '/assistente' },
  { label: 'Central de ajuda', href: '/docs' },
  { label: 'Tutoriais', href: '/tutoriais' },
  { label: 'Referência da API', href: '/api' },
  { label: 'Novidades', href: '/blog' },
];

export function SiteShell({ docs, api, children }: { docs: NavGroup[]; api: NavGroup[]; children: ReactNode }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState<{ open: boolean; path: string }>({ open: false, path: pathname });
  // Fecha o menu ao navegar sem precisar de efeito.
  const open = menu.open && menu.path === pathname;
  const section = isActive(pathname, '/api') ? 'api' : isActive(pathname, '/docs') ? 'docs' : undefined;
  const groups = section === 'api' ? api : section === 'docs' ? docs : undefined;

  return (
    <div
      className="ih-app"
      data-section={section ?? (isActive(pathname, '/assistente') ? 'assistente' : 'page')}
      data-assistant={assistantEnabled ? 'on' : 'off'}
    >
      <SiteHeader menuOpen={open} onMenu={() => setMenu({ open: !open, path: pathname })} />
      <div className={groups ? 'ih-body ih-body-sidebar' : 'ih-body'}>
        {groups && section ? (
          <aside className="ih-sidebar-wrap" data-open={open || undefined}>
            <nav className="ih-drawer-sections" aria-label="Seções da documentação">
              {sections.map((item) => (
                <Link key={item.href} href={item.href} data-active={isActive(pathname, item.href) || undefined}>{item.label}</Link>
              ))}
            </nav>
            <Sidebar groups={groups} section={section} />
          </aside>
        ) : (
          <aside className="ih-sidebar-wrap ih-drawer-only" data-open={open || undefined}>
            <nav className="ih-drawer-sections" aria-label="Seções da documentação">
              {sections.map((item) => (
                <Link key={item.href} href={item.href} data-active={isActive(pathname, item.href) || undefined}>{item.label}</Link>
              ))}
            </nav>
          </aside>
        )}
        {open ? <button type="button" className="ih-scrim" aria-label="Fechar menu" onClick={() => setMenu({ open: false, path: pathname })} /> : null}
        <div className="ih-main">{children}</div>
      </div>
      <AssistantLauncher />
      <AssistantDrawer />
    </div>
  );
}

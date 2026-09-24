'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import type { NavGroup, NavItem } from '@/lib/site';

function normalize(path: string) {
  return path.replace(/\/$/, '') || '/';
}

function contains(item: NavItem, pathname: string): boolean {
  return (item.url !== undefined && normalize(item.url) === pathname) || Boolean(item.children?.some((child) => contains(child, pathname)));
}

function MethodBadge({ method }: { method?: string }) {
  const value = method ?? 'DOC';
  return <span className="ih-method" data-method={value}>{value}</span>;
}

function Item({ item, api, depth }: { item: NavItem; api: boolean; depth: number }) {
  const pathname = normalize(usePathname());
  const active = item.url !== undefined && normalize(item.url) === pathname;
  const open = item.children?.length ? contains(item, pathname) : false;
  const label = (
    <>
      {api ? <MethodBadge method={item.method} /> : null}
      <span className="ih-side-label">{item.title}</span>
    </>
  );

  return (
    <li>
      {item.url ? (
        <Link href={item.url} className="ih-side-link" data-active={active || undefined} data-depth={depth} aria-current={active ? 'page' : undefined}>
          {label}
        </Link>
      ) : (
        <span className="ih-side-link ih-side-folder" data-depth={depth}>{label}</span>
      )}
      {item.children?.length && (open || !item.url) ? (
        <ul className="ih-side-sub">
          {item.children.map((child) => <Item key={`${child.title}-${child.url}`} item={child} api={api} depth={depth + 1} />)}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Grupos recolhíveis. Sem escolha da pessoa, abre o grupo da página atual e o primeiro, como no desenho.
 * A escolha vale enquanto ela navega (o menu fica no layout e não é recriado).
 */
export function useCollapsible<T extends { title: string }>(groups: T[], isActive: (group: T) => boolean) {
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const openOf = (group: T, index: number) => choice[group.title] ?? (isActive(group) || index === 0);
  const anyOpen = groups.some((group, index) => openOf(group, index));
  return {
    openOf,
    toggle: (group: T, index: number) => setChoice((current) => ({ ...current, [group.title]: !openOf(group, index) })),
    allLabel: anyOpen ? 'Recolher tudo' : 'Expandir tudo',
    toggleAll: () => setChoice(Object.fromEntries(groups.map((group) => [group.title, !anyOpen]))),
  };
}

export function GroupToggle({ open, count, title, controls, onClick, variant }: {
  open: boolean;
  count: number;
  title: string;
  controls: string;
  onClick: () => void;
  variant: 'help' | 'api';
}) {
  return (
    <button type="button" className="ih-side-group-toggle" data-variant={variant} aria-expanded={open} aria-controls={controls} onClick={onClick}>
      <ChevronRight aria-hidden="true" />
      <span className="ih-side-group-title">{title}</span>
      <span className="ih-side-count" aria-label={`${count} itens`}>{count}</span>
    </button>
  );
}

export function Sidebar({ groups, section }: { groups: NavGroup[]; section: 'docs' | 'api' }) {
  const api = section === 'api';
  const pathname = normalize(usePathname());
  const { setOpenSearch } = useSearchContext();
  const base = useId();
  const collapse = useCollapsible(groups, (group) => group.items.some((item) => contains(item, pathname)));

  return (
    <nav className={api ? 'ih-sidebar ih-sidebar-api' : 'ih-sidebar'} aria-label={api ? 'Referência da API' : 'Central de ajuda'}>
      {api ? (
        <>
          <button type="button" className="ih-side-search" onClick={() => setOpenSearch(true)}>
            <Search aria-hidden="true" />
            <span>Buscar endpoint</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="ih-side-head ih-side-head-api">
            <button type="button" className="ih-side-all" onClick={collapse.toggleAll}>{collapse.allLabel}</button>
          </div>
        </>
      ) : (
        <div className="ih-side-head">
          <p className="ih-side-kicker">Central de ajuda</p>
          <button type="button" className="ih-side-all" onClick={collapse.toggleAll}>{collapse.allLabel}</button>
        </div>
      )}
      {groups.map((group, index) => {
        const open = collapse.openOf(group, index);
        const listId = `${base}-g${index}`;
        return (
          <div className="ih-side-group" key={`${group.title}-${index}`} data-open={open || undefined}>
            {group.title ? (
              <GroupToggle
                open={open}
                count={group.items.length}
                title={group.title}
                controls={listId}
                onClick={() => collapse.toggle(group, index)}
                variant={api ? 'api' : 'help'}
              />
            ) : null}
            <ul id={listId} hidden={Boolean(group.title) && !open}>
              {group.items.map((item) => <Item key={`${item.title}-${item.url}`} item={item} api={api} depth={0} />)}
            </ul>
          </div>
        );
      })}
      {api ? null : (
        <div className="ih-side-promo">
          <strong>Prefere ver na prática?</strong>
          <p>Os tutoriais guiados destacam cada clique dentro do próprio iHelp.</p>
          <Link href="/tutoriais">Abrir tutoriais</Link>
        </div>
      )}
    </nav>
  );
}

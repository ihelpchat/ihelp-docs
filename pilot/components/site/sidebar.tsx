'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
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

export function Sidebar({ groups, section }: { groups: NavGroup[]; section: 'docs' | 'api' }) {
  const api = section === 'api';
  const { setOpenSearch } = useSearchContext();

  return (
    <nav className={api ? 'ih-sidebar ih-sidebar-api' : 'ih-sidebar'} aria-label={api ? 'Referência da API' : 'Central de ajuda'}>
      {api ? (
        <button type="button" className="ih-side-search" onClick={() => setOpenSearch(true)}>
          <Search aria-hidden="true" />
          <span>Buscar endpoint</span>
          <kbd>⌘K</kbd>
        </button>
      ) : (
        <p className="ih-side-kicker">Central de ajuda</p>
      )}
      {groups.map((group, index) => (
        <div className="ih-side-group" key={`${group.title}-${index}`}>
          {group.title ? <p className="ih-side-title">{group.title}</p> : null}
          <ul>
            {group.items.map((item) => <Item key={`${item.title}-${item.url}`} item={item} api={api} depth={0} />)}
          </ul>
        </div>
      ))}
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

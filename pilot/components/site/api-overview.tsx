import Link from 'next/link';
import { getNavGroups, type NavItem } from '@/lib/site';

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

export function ApiIntro({ title, description }: { title: string; description: string }) {
  return (
    <>
      <p className="ih-mono-kicker">apiv3.ihelpchat.com / api / v2</p>
      <h1 className="ih-title">{title}</h1>
      <p className="ih-lead">{description}</p>
      <dl className="ih-facts">
        <div><dt>Base URL</dt><dd>apiv3.ihelpchat.com/api/v2</dd></div>
        <div><dt>Autenticação</dt><dd>Bearer token</dd></div>
        <div><dt>Formato</dt><dd>application/json</dd></div>
      </dl>
    </>
  );
}

export function ApiResources() {
  const groups = getNavGroups('api').slice(1);
  return (
    <section className="ih-resources" aria-labelledby="recursos">
      <h2 id="recursos">Recursos</h2>
      <div className="ih-resource-grid">
        {groups.map((group) => {
          const pages = flatten(group.items).filter((item) => item.url);
          const endpoints = pages.filter((item) => item.method).length;
          const first = pages[0];
          return first?.url ? (
            <Link key={group.title} href={first.url} className="ih-resource">
              <span className="ih-resource-head">
                <strong>{group.title}</strong>
                <span>{endpoints ? `${endpoints} endpoints` : `${pages.length} páginas`}</span>
              </span>
              <span className="ih-resource-text">{pages.slice(0, 4).map((item) => item.title).join(', ')}.</span>
            </Link>
          ) : null;
        })}
      </div>
    </section>
  );
}

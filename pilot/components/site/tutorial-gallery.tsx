'use client';

import { ChevronLeft, ChevronRight, ExternalLink, Play, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { withBasePath } from '@/lib/shared';
import { GroupToggle, useCollapsible } from '@/components/site/sidebar';

export type Tutorial = {
  title: string;
  description: string;
  embedUrl?: string;
  url?: string;
  category: string;
};

function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

/**
 * Tutoriais guiados: menu “Módulos” (filtro + grupos recolhíveis), player e lista do módulo atual.
 * O Tango só abre dentro da página quando o guia tem embed público (`embedUrl`); os que exigem
 * a extensão/login do Tango abrem no próprio Tango.
 */
export function TutorialGallery({ tutorials, title }: { tutorials: Tutorial[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const base = useId();
  const current = tutorials[index];
  const needle = normalize(filter.trim());
  const matches = (tutorial: Tutorial) => !needle || normalize(`${tutorial.title} ${tutorial.category}`).includes(needle);

  const modules = [...new Set(tutorials.map((tutorial) => tutorial.category))]
    .map((category) => ({ title: category, items: tutorials.map((tutorial, position) => ({ tutorial, position })).filter(({ tutorial }) => tutorial.category === category && matches(tutorial)) }))
    .filter((group) => group.items.length);
  const collapse = useCollapsible(modules, (group) => group.items.some(({ position }) => position === index));

  if (!current) return null;
  const select = (position: number) => {
    setIndex(position);
    setLoaded(null);
  };
  const sameModule = tutorials.map((tutorial, position) => ({ tutorial, position })).filter(({ tutorial }) => tutorial.category === current.category && matches(tutorial));
  const poster = withBasePath(current.category === 'CRM' ? '/brand/preview-crm.png' : '/brand/preview-chat.webp');

  return (
    <div className="ih-tut-layout">
      <aside className="ih-tut-aside" aria-label="Módulos dos tutoriais">
        <div className="ih-side-head">
          <p className="ih-side-kicker">Módulos</p>
          {modules.length ? <button type="button" className="ih-side-all" onClick={collapse.toggleAll}>{collapse.allLabel}</button> : null}
        </div>
        <label className="ih-tut-filter">
          <Search aria-hidden="true" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar guias" aria-label="Filtrar guias" />
        </label>
        {modules.map((group, groupIndex) => {
          // Com filtro ativo, todos os grupos com resultado ficam abertos (como no desenho).
          const open = needle ? true : collapse.openOf(group, groupIndex);
          const listId = `${base}-m${groupIndex}`;
          return (
            <div className="ih-side-group" key={group.title}>
              <GroupToggle open={open} count={group.items.length} title={group.title} controls={listId} onClick={() => collapse.toggle(group, groupIndex)} variant="help" />
              <ul id={listId} className="ih-side-sub-list" hidden={!open}>
                {group.items.map(({ tutorial, position }) => (
                  <li key={tutorial.url ?? tutorial.title}>
                    <button type="button" className="ih-side-link" data-active={position === index || undefined} aria-current={position === index ? 'true' : undefined} onClick={() => select(position)}>
                      <span className="ih-side-label">{tutorial.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {modules.length ? null : (
          <p className="ih-tut-empty">
            Nenhum guia encontrado.{' '}
            <button type="button" onClick={() => setFilter('')}>Limpar filtros</button>
          </p>
        )}
      </aside>

      <div className="ih-tut-main">
        <header className="ih-page-header ih-page-header-split">
          <div>
            <h1 className="ih-title">{title}</h1>
            <p className="ih-lead">Guias interativos que mostram cada clique dentro do iHelp. Acompanhe aqui o passo a passo ou abra o guia no Tango.</p>
          </div>
          <p className="ih-status-pill"><span aria-hidden="true" />{tutorials.length} guias publicados no Tango</p>
        </header>

        <div className="ih-tutorials">
          <section className="ih-player" aria-label={`Tutorial: ${current.title}`}>
            <header>
              <div>
                <h2>{current.title}</h2>
                <p>{current.category} · guia publicado no Tango</p>
              </div>
              {current.url || current.embedUrl ? (
                <a className="ih-button ih-button-primary" href={current.url ?? current.embedUrl} target="_blank" rel="noreferrer noopener">
                  <Play aria-hidden="true" />Abrir no Tango<span className="ih-visually-hidden"> (abre em nova aba)</span>
                </a>
              ) : null}
            </header>
            <div className="ih-player-frame">
              <span className="ih-player-badge"><span aria-hidden="true" />Guia {index + 1} de {tutorials.length}</span>
              {current.embedUrl && loaded === current.embedUrl ? (
                <iframe
                  key={current.embedUrl}
                  src={current.embedUrl}
                  title={current.title}
                  sandbox="allow-scripts allow-top-navigation-by-user-activation allow-popups allow-same-origin"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : current.embedUrl ? (
                <button type="button" className="ih-player-poster" onClick={() => setLoaded(current.embedUrl!)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poster} alt="" />
                  <span className="ih-player-start"><Play aria-hidden="true" />Ver o passo a passo aqui</span>
                </button>
              ) : (
                <a className="ih-player-poster" href={current.url} target="_blank" rel="noreferrer noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poster} alt="" />
                  <span className="ih-player-start"><ExternalLink aria-hidden="true" />Abrir passo a passo no Tango</span>
                </a>
              )}
            </div>
            <footer>
              <p>{current.description}</p>
              <div className="ih-player-controls">
                <button type="button" className="ih-button" onClick={() => select(Math.max(0, index - 1))} disabled={index === 0}>
                  <ChevronLeft aria-hidden="true" />Anterior
                </button>
                <button type="button" className="ih-button ih-button-dark" onClick={() => select((index + 1) % tutorials.length)}>
                  Próximo guia<ChevronRight aria-hidden="true" />
                </button>
                <span className="ih-dots" aria-hidden="true">
                  {tutorials.map((tutorial, dot) => <span key={tutorial.url ?? tutorial.embedUrl ?? tutorial.title} data-active={dot === index || undefined} />)}
                </span>
              </div>
            </footer>
          </section>

          <div className="ih-guide-column">
            <p className="ih-eyebrow">Guias de {current.category}</p>
            <ul className="ih-guides">
              {sameModule.map(({ tutorial, position }) => (
                <li key={tutorial.url ?? tutorial.embedUrl ?? tutorial.title}>
                  <button type="button" className="ih-guide" aria-pressed={position === index} onClick={() => select(position)}>
                    <span className="ih-guide-icon"><Play aria-hidden="true" /></span>
                    <span className="ih-guide-copy">
                      <strong>{tutorial.title}</strong>
                      <span>{tutorial.embedUrl ? 'Abre nesta página' : 'Abre no Tango'}</span>
                    </span>
                    <span className="ih-pill" data-kind="tutorial">{tutorial.category}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="ih-note-card">
              <strong>Time de suporte</strong>
              <p>Cada guia publicado no Tango entra nesta página. Sentiu falta de algum passo a passo? Peça pelo suporte.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

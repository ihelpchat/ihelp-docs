'use client';

import { Children, useState, type ReactNode } from 'react';

/** Abas de linguagem sobre blocos de código (cURL, Node, Python…), no cartão escuro do desenho. */
export function CodeTabs({ labels, children }: { labels: string[]; children: ReactNode }) {
  const [active, setActive] = useState(0);
  const blocks = Children.toArray(children).filter((child) => typeof child !== 'string');
  return (
    <div className="ih-code-card">
      <div className="ih-code-head" role="tablist" aria-label="Linguagem do exemplo">
        {labels.map((label, index) => (
          <button key={label} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}>{label}</button>
        ))}
      </div>
      {blocks.map((block, index) => (
        <div key={labels[index] ?? index} role="tabpanel" hidden={index !== active}>{block}</div>
      ))}
    </div>
  );
}

/** Resposta de exemplo com status e opção de ver tudo quando é longa. */
export function Response({ status = '200 OK', children }: { status?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ih-code-card" data-collapsed={!open || undefined}>
      <div className="ih-code-head">
        <span className="ih-status" data-ok={status.startsWith('2') || undefined}>{status}</span>
        <span className="ih-code-spacer" />
        <button type="button" className="ih-code-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Resumir resposta' : 'Ver resposta completa'}
        </button>
      </div>
      {children}
    </div>
  );
}

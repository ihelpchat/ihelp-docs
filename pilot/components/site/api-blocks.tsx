import type { ReactNode } from 'react';

/** Tabela de parâmetros de um endpoint. */
export function Params({ children }: { children: ReactNode }) {
  return <div className="ih-params">{children}</div>;
}

/** `required` só aparece quando a documentação afirma; sem a informação, não mostramos selo. */
export function Param({ name, type, required, children }: { name: string; type: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="ih-param">
      <code className="ih-param-name">{name}</code>
      <code className="ih-param-type">{type}</code>
      {required === undefined ? <span /> : <span className="ih-param-req" data-required={required || undefined}>{required ? 'obrigatório' : 'opcional'}</span>}
      <div className="ih-param-text">{children}</div>
    </div>
  );
}

/** Lista de campos relevantes da resposta. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="ih-params ih-fields">{children}</div>;
}

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="ih-field">
      <code className="ih-param-name">{name}</code>
      <div className="ih-param-text">{children}</div>
    </div>
  );
}

/** Cartões numerados de “primeiros passos”. */
export function StepCards({ children }: { children: ReactNode }) {
  return <div className="ih-step-cards">{children}</div>;
}

export function StepCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ih-step-card">
      <p className="ih-step-card-title">{title}</p>
      <div className="ih-step-card-text">{children}</div>
    </div>
  );
}

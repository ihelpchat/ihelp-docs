import { AlertTriangle, Info, Lightbulb, OctagonAlert } from 'lucide-react';
import type { ReactNode } from 'react';

const kinds = {
  info: { icon: Info, label: 'Informação' },
  warn: { icon: AlertTriangle, label: 'Atenção' },
  warning: { icon: AlertTriangle, label: 'Atenção' },
  error: { icon: OctagonAlert, label: 'Importante' },
  idea: { icon: Lightbulb, label: 'Dica' },
  success: { icon: Info, label: 'Pronto' },
} as const;

type CalloutProps = {
  type?: keyof typeof kinds;
  title?: ReactNode;
  children?: ReactNode;
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const kind = kinds[type] ?? kinds.info;
  const Icon = kind.icon;
  const tone = type === 'warning' ? 'warn' : type;
  return (
    <div className="ih-callout" data-type={tone} role="note">
      <Icon aria-hidden="true" />
      <div>
        {title ? <p className="ih-callout-title">{title}</p> : null}
        <div className="ih-callout-body">{children}</div>
      </div>
    </div>
  );
}

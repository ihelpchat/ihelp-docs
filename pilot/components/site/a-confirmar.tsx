import type { ReactNode } from 'react';

export function AConfirmar({ children }: { children: ReactNode }) {
  const preview = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'preview'
    || process.env.RAILWAY_ENVIRONMENT_NAME === 'staging';
  return <span className={preview ? 'a-confirmar' : undefined}>
    {children}{preview && <span className="a-confirmar-label"> A confirmar</span>}
  </span>;
}

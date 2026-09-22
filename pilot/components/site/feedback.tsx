'use client';

import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { supportPhone, supportUrl } from '@/lib/links';

export function Feedback() {
  const [answer, setAnswer] = useState<'up' | 'down' | null>(null);

  return (
    <div className="ih-feedback">
      {answer === null ? (
        <>
          <p>Este artigo resolveu sua dúvida?</p>
          <div>
            <button type="button" className="ih-button" onClick={() => setAnswer('up')}><ThumbsUp aria-hidden="true" />Sim</button>
            <button type="button" className="ih-button" onClick={() => setAnswer('down')}><ThumbsDown aria-hidden="true" />Não</button>
          </div>
        </>
      ) : answer === 'up' ? (
        <p className="ih-feedback-done" role="status"><Check aria-hidden="true" />Que bom! Obrigado pelo retorno.</p>
      ) : (
        <p className="ih-feedback-done ih-feedback-help" role="status">
          Fale com o suporte pelo <a href={supportUrl} target="_blank" rel="noreferrer noopener">{supportPhone}</a> que a gente ajuda.
        </p>
      )}
    </div>
  );
}

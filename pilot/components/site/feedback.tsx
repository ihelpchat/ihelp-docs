'use client';

import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { submitFeedback, type FeedbackValue } from '@/lib/feedback';
import { supportPhone, supportUrl } from '@/lib/links';

export function Feedback() {
  const [answer, setAnswer] = useState<'up' | 'down' | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const pathname = usePathname();

  const rate = async (value: FeedbackValue) => {
    setSending(true);
    setError(false);
    const saved = await submitFeedback({ type: 'article', value, path: pathname });
    setSending(false);
    if (saved) setAnswer(value);
    else setError(true);
  };

  return (
    <div className="ih-feedback">
      {answer === null ? (
        <>
          <p>Este artigo resolveu sua dúvida?</p>
          <div>
            <button type="button" className="ih-button" disabled={sending} onClick={() => void rate('up')}><ThumbsUp aria-hidden="true" />Sim</button>
            <button type="button" className="ih-button" disabled={sending} onClick={() => void rate('down')}><ThumbsDown aria-hidden="true" />Não</button>
          </div>
          {error ? <small role="alert">Não conseguimos registrar agora. Tente novamente.</small> : null}
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

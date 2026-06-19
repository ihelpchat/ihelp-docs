import React, {useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './AITutorialSearch.module.css';

type Tutorial = {
  title: string;
  url: string;
  keywords: string[];
};

export const TUTORIALS: Tutorial[] = [
  {
    title: 'Como conectar um canal via QRCode',
    url: 'https://app.tango.us/app/workflow/Como-conectar-um-canal-via-QRCode-16971f80d1924934b5f9b8029d987770',
    keywords: ['canal', 'qrcode', 'qr', 'conectar', 'whatsapp', 'codigo', 'escanear'],
  },
  {
    title: 'Adicionar Motivo de encerramento',
    url: 'https://app.tango.us/app/workflow/Adicionar-Motivo-de-encerramento-d851dc72e94b47138d9716aed1f85a66',
    keywords: ['motivo', 'encerramento', 'fechar', 'finalizar', 'atendimento', 'encerrar', 'razao'],
  },
  {
    title: 'Criar template para API Oficial',
    url: 'https://app.tango.us/app/workflow/Criar-template-para-API-Oficial-7206c279d8c54f2da8be910096dc1fbb',
    keywords: ['template', 'api', 'oficial', 'mensagem', 'modelo', 'criar', 'business', 'waba'],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findBestMatch(query: string): {tutorial: Tutorial; score: number} {
  const words = normalize(query).split(/\s+/).filter(w => w.length >= 3);
  let best = TUTORIALS[0];
  let bestScore = 0;

  for (const tutorial of TUTORIALS) {
    let score = 0;
    const titleWords = normalize(tutorial.title).split(/\s+/);
    for (const word of words) {
      for (const kw of tutorial.keywords) {
        if (normalize(kw).includes(word) || word.includes(normalize(kw))) score += 2;
      }
      for (const tw of titleWords) {
        if (tw.includes(word) || word.includes(tw)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = tutorial;
    }
  }

  return {tutorial: best, score: bestScore};
}

type Result = {
  tutorial: Tutorial;
  explanation: string;
};

export default function AITutorialSearch(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const apiKey = (siteConfig.customFields?.claudeApiKey as string) || '';

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setResult(null);
    setError('');

    try {
      if (apiKey) {
        const systemPrompt = `Você é um assistente da documentação iHelp. Com base na dúvida do usuário, indique o tutorial mais adequado da lista abaixo e explique em 1-2 frases curtas por que ele é o mais indicado. Responda SOMENTE em JSON, sem texto extra: {"index": <índice do tutorial, começando em 0>, "explanation": "<explicação curta em português>"}

Tutoriais disponíveis:
${TUTORIALS.map((t, i) => `${i}. ${t.title}`).join('\n')}`;

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            system: systemPrompt,
            messages: [{role: 'user', content: q}],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const parsed = JSON.parse(data.content[0].text);
          const tutorial = TUTORIALS[parsed.index] ?? TUTORIALS[0];
          setResult({tutorial, explanation: parsed.explanation});
          return;
        }
      }

      // Fallback: keyword matching
      await new Promise(r => setTimeout(r, 500));
      const {tutorial} = findBestMatch(q);
      setResult({
        tutorial,
        explanation: `Com base na sua dúvida, este é o tutorial mais indicado para você.`,
      });
    } catch {
      setError('Não foi possível processar sua busca. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder="Ex: como conectar o WhatsApp?"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          disabled={loading}
        />
        <button
          className={styles.button}
          onClick={search}
          disabled={loading || !query.trim()}
        >
          {loading ? <span className={styles.spinner} /> : <>✨ Buscar com IA</>}
        </button>
      </div>

      {result && (
        <div className={styles.result}>
          <p className={styles.explanation}>💡 {result.explanation}</p>
          <a
            href={result.tutorial.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.card}
          >
            <span className={styles.cardIcon}>🎓</span>
            <span className={styles.cardTitle}>{result.tutorial.title}</span>
            <span className={styles.cardCta}>Abrir tutorial →</span>
          </a>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

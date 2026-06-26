import React, {useState, useEffect, useRef} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Link from '@docusaurus/Link';
import styles from './AITutorialSearch.module.css';

type ContentPage = {
  title: string;
  url: string;
  section: string;
  excerpt: string;
  headings: string[];
};

type SearchResult = {
  page: ContentPage;
};

type Phase = 'idle' | 'clarifying' | 'done';

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('coes')) return word.slice(0, -4) + 'c';
  if (word.endsWith('oes')) return word.slice(0, -3);
  if (word.endsWith('ens')) return word.slice(0, -3) + 'em';
  if (word.endsWith('ais')) return word.slice(0, -3) + 'al';
  if (word.endsWith('eis')) return word.slice(0, -3) + 'el';
  if (word.endsWith('ando')) return word.slice(0, -4);
  if (word.endsWith('endo')) return word.slice(0, -4);
  if (word.endsWith('indo')) return word.slice(0, -4);
  if (word.endsWith('mente')) return word.slice(0, -5);
  if (word.endsWith('ar') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ir') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('os') && word.length > 4) return word.slice(0, -1);
  if (word.endsWith('as') && word.length > 4) return word.slice(0, -1);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return word;
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

function keywordSearch(query: string, pages: ContentPage[]): SearchResult[] {
  const words = normalize(query).split(/\s+/).filter(w => w.length >= 3).map(stem);
  if (words.length === 0) return [];
  const scored = pages.map(page => {
    let score = 0;
    const titleStems = normalize(page.title).split(/\s+/).map(stem);
    const headingStems = (page.headings ?? [])
      .join(' ')
      .split(/\s+/)
      .map(w => stem(normalize(w)));
    for (const word of words) {
      if (titleStems.some(t => wordsMatch(t, word))) score += 2;
      if (headingStems.some(h => wordsMatch(h, word))) score += 1;
    }
    return {page, score};
  });
  return scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => ({page: r.page}));
}

async function callClaude(apiKey: string, messages: {role: string; content: string}[], system: string): Promise<string | null> {
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
      max_tokens: 400,
      system,
      messages,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.content[0].text;
}

const SECTION_ICON: Record<string, string> = {
  'Central de Ajuda': '💬',
  'Tutoriais Guiados': '🎓',
  'Novidades': '✨',
};

export default function AITutorialSearch(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const apiKey = (siteConfig.customFields?.claudeApiKey as string) || '';
  const indexUrl = useBaseUrl('/content-index.json');

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [clarifyingQ, setClarifyingQ] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [followLoading, setFollowLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const pagesRef = useRef<ContentPage[]>([]);
  const pageListRef = useRef('');

  useEffect(() => {
    fetch(indexUrl)
      .then(r => r.json())
      .then((data: ContentPage[]) => {
        pagesRef.current = data;
        pageListRef.current = data.map((p, i) => `${i}. [${p.section}] ${p.title}`).join('\n');
      })
      .catch(() => {});
  }, [indexUrl]);

  function applyResults(parsed: {indices: number[]; explanation?: string}) {
    const pages = pagesRef.current;
    const matched: SearchResult[] = (parsed.indices as number[])
      .filter((i: number) => i >= 0 && i < pages.length)
      .slice(0, 3)
      .map((i: number) => ({page: pages[i]}));
    setResults(matched);
    setExplanation(parsed.explanation || '');
    setPhase('done');
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setResults([]);
    setExplanation('');
    setClarifyingQ('');
    setFollowUp('');
    setError('');
    setPhase('idle');

    const pages = pagesRef.current;

    try {
      if (apiKey && pages.length > 0) {
        const system = `Você é um assistente da documentação iHelp. Analise a dúvida do usuário e tome UMA decisão:

1. Se a dúvida for clara: retorne os melhores resultados.
2. Se for vaga ou ambígua: faça UMA pergunta curta e objetiva para qualificar melhor.

Responda APENAS em JSON, sem texto extra:
- Para qualificar: {"type":"question","question":"<pergunta curta em português>"}
- Com resultados: {"type":"results","indices":[n,n,n],"explanation":"<frase curta>"}

Páginas disponíveis:
${pageListRef.current}`;

        const text = await callClaude(apiKey, [{role: 'user', content: q}], system);
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.type === 'question') {
            setClarifyingQ(parsed.question);
            setPhase('clarifying');
            return;
          }
          if (parsed.type === 'results') {
            applyResults(parsed);
            return;
          }
        }
      }

      // Fallback: busca por palavras-chave (sem pergunta de qualificação)
      await new Promise(r => setTimeout(r, 250));
      const matched = pages.length > 0 ? keywordSearch(q, pages) : [];
      if (matched.length === 0) {
        setError('Nenhum resultado encontrado. Tente outros termos.');
      } else {
        setResults(matched);
        setPhase('done');
      }
    } catch {
      setError('Não foi possível processar sua busca. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  async function answerFollowUp() {
    const a = followUp.trim();
    if (!a) return;
    setFollowLoading(true);
    setError('');

    try {
      const system = `Você é um assistente da documentação iHelp. Com base na conversa abaixo, selecione os melhores resultados.
Responda APENAS em JSON: {"type":"results","indices":[n,n,n],"explanation":"<frase curta>"}

Páginas disponíveis:
${pageListRef.current}`;

      const messages = [
        {role: 'user', content: query.trim()},
        {role: 'assistant', content: JSON.stringify({type: 'question', question: clarifyingQ})},
        {role: 'user', content: a},
      ];

      const text = await callClaude(apiKey, messages, system);
      if (text) {
        const parsed = JSON.parse(text);
        applyResults(parsed);
      } else {
        setError('Não foi possível processar. Tente novamente.');
      }
    } catch {
      setError('Não foi possível processar. Tente novamente.');
    } finally {
      setFollowLoading(false);
    }
  }

  function reset() {
    setQuery('');
    setFollowUp('');
    setResults([]);
    setExplanation('');
    setClarifyingQ('');
    setError('');
    setPhase('idle');
  }

  return (
    <div className={styles.wrapper}>
      {/* Input principal */}
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder="Ex: como conectar o WhatsApp?"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && phase === 'idle' && search()}
          disabled={loading || phase !== 'idle'}
        />
        {phase === 'idle' ? (
          <button
            className={styles.button}
            onClick={search}
            disabled={loading || !query.trim()}
          >
            {loading ? <span className={styles.spinner} /> : <>✨ Buscar com IA</>}
          </button>
        ) : (
          <button className={styles.buttonSecondary} onClick={reset}>
            Nova busca
          </button>
        )}
      </div>

      {/* Pergunta de qualificação */}
      {phase === 'clarifying' && (
        <div className={styles.clarifyBlock}>
          <p className={styles.clarifyQuestion}>🤔 {clarifyingQ}</p>
          <div className={styles.clarifyRow}>
            <input
              className={styles.clarifyInput}
              type="text"
              placeholder="Sua resposta..."
              value={followUp}
              onChange={e => setFollowUp(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && answerFollowUp()}
              autoFocus
              disabled={followLoading}
            />
            <button
              className={styles.clarifyButton}
              onClick={answerFollowUp}
              disabled={followLoading || !followUp.trim()}
            >
              {followLoading ? <span className={styles.spinner} /> : 'Responder →'}
            </button>
          </div>
        </div>
      )}

      {/* Resultados */}
      {explanation && <p className={styles.explanation}>💡 {explanation}</p>}

      {results.length > 0 && (
        <div className={styles.results}>
          {results.map((r, i) => (
            <Link key={i} to={r.page.url} className={styles.card}>
              <span className={styles.cardIcon}>
                {SECTION_ICON[r.page.section] ?? '📄'}
              </span>
              <span className={styles.cardBody}>
                <span className={styles.cardSection}>{r.page.section}</span>
                <span className={styles.cardTitle}>{r.page.title}</span>
              </span>
              <span className={styles.cardCta}>Abrir →</span>
            </Link>
          ))}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

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

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Stemmer simples para português: normaliza plurais e conjugações comuns
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('coes')) return word.slice(0, -4) + 'c';   // configurações→configurac
  if (word.endsWith('oes')) return word.slice(0, -3);           // operações→operas
  if (word.endsWith('ens')) return word.slice(0, -3) + 'em';   // mensagens→mensagem
  if (word.endsWith('ais')) return word.slice(0, -3) + 'al';   // canais→canal
  if (word.endsWith('eis')) return word.slice(0, -3) + 'el';   // papéis→papel
  if (word.endsWith('ando')) return word.slice(0, -4);          // conectando→conect
  if (word.endsWith('endo')) return word.slice(0, -4);
  if (word.endsWith('indo')) return word.slice(0, -4);
  if (word.endsWith('mente')) return word.slice(0, -5);
  if (word.endsWith('ar') && word.length > 4) return word.slice(0, -2); // conectar→conect
  if (word.endsWith('er') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ir') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('os') && word.length > 4) return word.slice(0, -1); // arquivos→arquivo
  if (word.endsWith('as') && word.length > 4) return word.slice(0, -1);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2); // departamentos→departament
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return word;
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  // prefixo comum de ao menos 4 chars cobre raízes distintas suficientemente
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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const pagesRef = useRef<ContentPage[]>([]);

  useEffect(() => {
    fetch(indexUrl)
      .then(r => r.json())
      .then((data: ContentPage[]) => {
        pagesRef.current = data;
      })
      .catch(() => {});
  }, [indexUrl]);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setResults([]);
    setExplanation('');
    setError('');

    const pages = pagesRef.current;

    try {
      if (apiKey && pages.length > 0) {
        const pageList = pages
          .map((p, i) => `${i}. [${p.section}] ${p.title}`)
          .join('\n');

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
            system: `Você é um assistente da documentação iHelp. Com base na dúvida do usuário, selecione os índices dos até 3 melhores resultados da lista abaixo e forneça uma explicação curta de 1 frase. Responda APENAS em JSON sem texto extra: {"indices": [n, n, n], "explanation": "<frase curta em português>"}

Páginas disponíveis:
${pageList}`,
            messages: [{role: 'user', content: q}],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const parsed = JSON.parse(data.content[0].text);
          const matched: SearchResult[] = (parsed.indices as number[])
            .filter((i: number) => i >= 0 && i < pages.length)
            .slice(0, 3)
            .map((i: number) => ({page: pages[i]}));
          setResults(matched);
          setExplanation(parsed.explanation || '');
          return;
        }
      }

      // Fallback: busca por palavras-chave
      await new Promise(r => setTimeout(r, 250));
      const matched = pages.length > 0 ? keywordSearch(q, pages) : [];
      if (matched.length === 0) {
        setError('Nenhum resultado encontrado. Tente outros termos.');
      } else {
        setResults(matched);
      }
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

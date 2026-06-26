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
};

type SearchResult = {
  page: ContentPage;
};

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function keywordSearch(query: string, pages: ContentPage[]): SearchResult[] {
  const words = normalize(query).split(/\s+/).filter(w => w.length >= 2);
  const scored = pages.map(page => {
    let score = 0;
    const titleNorm = normalize(page.title);
    const excerptNorm = normalize(page.excerpt);
    for (const word of words) {
      if (titleNorm.includes(word)) score += 4;
      if (excerptNorm.includes(word)) score += 1;
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

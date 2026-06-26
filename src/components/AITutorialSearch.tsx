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
  content: string;
  headings: string[];
};

type KnowledgeEntry = {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
  url: string;
  section: string;
};

type SearchResult = {page: ContentPage};

type BotMessage =
  | {id: string; role: 'bot'; kind: 'text'; text: string}
  | {id: string; role: 'bot'; kind: 'results'; answer: string; results: SearchResult[]}
  | {id: string; role: 'bot'; kind: 'loading'};

type UserMessage = {id: string; role: 'user'; text: string};

type Message = BotMessage | UserMessage;

type ClaudeMsg = {role: 'user' | 'assistant'; content: string};

// ─── Utilities ────────────────────────────────────────────────────────────────

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

function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(w => w.length >= 3).map(stem);
}

function keywordSearch(query: string, pages: ContentPage[]): SearchResult[] {
  // Filtra stop words para não pontuar palavras como "como", "que", "para"
  const words = queryWords(query).filter(w => !STOP_WORDS.has(w));
  if (words.length === 0) return [];
  const scored = pages.map(page => {
    let score = 0;
    const titleStems = normalize(page.title).split(/\s+/).map(stem).filter(w => !STOP_WORDS.has(w));
    const headingStems = (page.headings ?? []).join(' ').split(/\s+/)
      .map(w => stem(normalize(w))).filter(w => !STOP_WORDS.has(w));
    for (const word of words) {
      if (titleStems.some(t => wordsMatch(t, word))) score += 2;
      if (headingStems.some(h => wordsMatch(h, word))) score += 1;
    }
    return {page, score};
  });
  return scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(r => ({page: r.page}));
}

// Palavras genéricas que não pontuam na busca — comuns demais para distinguir tópicos
const STOP_WORDS = new Set([
  'com', 'como', 'que', 'nao', 'para', 'uma', 'um', 'uns', 'meu', 'minha', 'seu', 'sua',
  'ter', 'tem', 'por', 'nos', 'ele', 'ela', 'dos', 'das', 'isso', 'est',
  'foi', 'ser', 'mas', 'mais', 'qual', 'qua', 'ver', 'get', 'low', 'baixo',
  'faz', 'faz', 'pod', 'conseg', 'precis',
]);

function kbSearch(query: string, kb: KnowledgeEntry[]): {entry: KnowledgeEntry; score: number} | null {
  const words = queryWords(query).filter(w => !STOP_WORDS.has(w));
  if (words.length === 0) return null;

  // Para ter match, ao menos 2 palavras devem coincidir (ou 1 se query tiver só 1 palavra significativa)
  const minScore = words.length >= 2 ? 2 : 1;

  let best: KnowledgeEntry | null = null;
  let bestScore = 0;

  for (const entry of kb) {
    // Explode cada keyword em palavras individuais para evitar false positives com frases
    const kbWordSet = new Set<string>();
    for (const kw of entry.keywords) {
      for (const w of normalize(kw).split(/\s+/)) {
        const s = stem(w);
        if (s.length >= 3 && !STOP_WORDS.has(s)) kbWordSet.add(s);
      }
    }

    let score = 0;
    for (const word of words) {
      if ([...kbWordSet].some(k => wordsMatch(k, word))) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return best && bestScore >= minScore ? {entry: best, score: bestScore} : null;
}

// Renders inline **bold** markers as <strong>
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

async function callClaude(apiKey: string, messages: ClaudeMsg[], system: string): Promise<string | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 900, system, messages}),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.content[0].text;
}

let _id = 0;
const uid = () => String(++_id);

const GREETING = 'Olá! Como posso te ajudar hoje?';
const SUPPORT_URL = 'https://wa.me/551730422307';

function SupportLink(): JSX.Element {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.supportLink}
    >
      <span className={styles.supportIcon}>💬</span>
      Falar com o suporte iHelp
    </a>
  );
}

const SECTION_ICON: Record<string, string> = {
  'Central de Ajuda': '💬',
  'Tutoriais Guiados': '🎓',
  'Novidades': '✨',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AITutorialSearch(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const apiKey = (siteConfig.customFields?.claudeApiKey as string) || '';
  const indexUrl = useBaseUrl('/content-index.json');
  const kbUrl = useBaseUrl('/knowledge-base.json');

  const [messages, setMessages] = useState<Message[]>([
    {id: uid(), role: 'bot', kind: 'text', text: GREETING},
  ]);
  const [claudeHistory, setClaudeHistory] = useState<ClaudeMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef<ContentPage[]>([]);
  const pageListRef = useRef('');
  const kbRef = useRef<KnowledgeEntry[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(indexUrl)
      .then(r => r.json())
      .then((data: ContentPage[]) => {
        pagesRef.current = data;
        pageListRef.current = data.map((p, i) => `${i}. [${p.section}] ${p.title}`).join('\n');
      })
      .catch(() => {});

    fetch(kbUrl)
      .then(r => r.json())
      .then((data: KnowledgeEntry[]) => { kbRef.current = data; })
      .catch(() => {});
  }, [indexUrl, kbUrl]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function addMessage(msg: Message) {
    setMessages(prev => {
      const filtered = prev.filter(m => !(m.role === 'bot' && (m as BotMessage).kind === 'loading'));
      return [...filtered, msg];
    });
  }

  function addLoading() {
    setMessages(prev => [...prev, {id: uid(), role: 'bot', kind: 'loading'} as BotMessage]);
  }

  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setLoading(true);

    const userMsg: UserMessage = {id: uid(), role: 'user', text: q};
    setMessages(prev => [...prev, userMsg]);

    const newClaudeHistory: ClaudeMsg[] = [...claudeHistory, {role: 'user', content: q}];
    addLoading();

    const pages = pagesRef.current;
    const kb = kbRef.current;

    try {
      // ── Caminho 1: Claude API disponível ──────────────────────────────────
      if (apiKey && pages.length > 0) {
        const candidates = keywordSearch(q, pages).slice(0, 5);
        const contextPages = candidates.length > 0 ? candidates : pages.slice(0, 5).map(p => ({page: p}));

        const contextBlock = contextPages.map(r => {
          const p = r.page;
          return `=== [${p.section}] ${p.title} ===\n${p.content}`;
        }).join('\n\n');

        const system = `Você é um assistente simpático e prestativo da documentação iHelp. Responda SEMPRE em JSON válido.

Analise a dúvida e tome UMA decisão:
1. Dúvida clara → leia o conteúdo das páginas abaixo e escreva uma resposta detalhada e conversacional, como uma pessoa explicaria. Use as informações reais do conteúdo. O campo "answer" é OBRIGATÓRIO e nunca pode ser vazio.
2. Dúvida vaga → faça UMA pergunta curta para qualificar.

Formato obrigatório:
- Para qualificar: {"type":"question","question":"<pergunta curta em português>"}
- Com resposta: {"type":"results","indices":[n,n,n],"answer":"<resposta baseada no conteúdo real, 3-8 frases conversacionais, linguagem simples e amigável, use \\n• para listar passos, use **texto** para destacar>"}

IMPORTANTE: Baseie a resposta EXCLUSIVAMENTE no conteúdo das páginas abaixo. Nunca invente.

Conteúdo das páginas:

${contextBlock}

Índice completo (use os números em "indices"):
${pageListRef.current}`;

        const text = await callClaude(apiKey, newClaudeHistory, system);

        if (text) {
          try {
            const parsed = JSON.parse(text);

            if (parsed.type === 'question') {
              const question = parsed.question as string;
              setClaudeHistory([...newClaudeHistory, {role: 'assistant', content: question}]);
              addMessage({id: uid(), role: 'bot', kind: 'text', text: question});
              return;
            }

            if (parsed.type === 'results') {
              const results: SearchResult[] = ((parsed.indices as number[]) || [])
                .filter((i: number) => i >= 0 && i < pages.length)
                .slice(0, 3)
                .map((i: number) => ({page: pages[i]}));
              const answer = parsed.answer || '';
              setClaudeHistory([...newClaudeHistory, {role: 'assistant', content: answer}]);
              addMessage({id: uid(), role: 'bot', kind: 'results', answer, results});
              return;
            }
          } catch {
            // JSON parse falhou — cai para KB
          }
        }
      }

      // ── Caminho 2: Knowledge base pré-gerada ─────────────────────────────
      const kbMatch = kb.length > 0 ? kbSearch(q, kb) : null;

      if (kbMatch) {
        const {entry} = kbMatch;
        // Links: página canônica do KB + busca por palavras-chave
        const canonicalPage = pages.find(p => p.url === entry.url);
        const kwResults = keywordSearch(q, pages);
        const seen = new Set<string>();
        const results: SearchResult[] = [];
        if (canonicalPage) { results.push({page: canonicalPage}); seen.add(canonicalPage.url); }
        for (const r of kwResults) {
          if (!seen.has(r.page.url)) { results.push(r); seen.add(r.page.url); }
          if (results.length >= 3) break;
        }

        setClaudeHistory(newClaudeHistory);
        addMessage({id: uid(), role: 'bot', kind: 'results', answer: entry.answer, results});
        return;
      }

      // ── Caminho 3: Busca por palavras-chave (fallback) ───────────────────
      setClaudeHistory(newClaudeHistory);
      const results = pages.length > 0 ? keywordSearch(q, pages) : [];
      if (results.length === 0) {
        addMessage({id: uid(), role: 'bot', kind: 'text', text: 'Não encontrei resultados para essa busca. Pode tentar outros termos?'});
      } else {
        addMessage({id: uid(), role: 'bot', kind: 'results', answer: 'Encontrei estas páginas que podem te ajudar:', results});
      }
    } catch {
      addMessage({id: uid(), role: 'bot', kind: 'text', text: 'Ocorreu um erro ao processar sua busca. Tente novamente.'});
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className={styles.chatWrapper}>
      {/* Header */}
      <div className={styles.chatHeader}>
        <span className={styles.chatHeaderIcon}>🤖</span>
        <span className={styles.chatHeaderTitle}>Assistente iHelp</span>
      </div>

      {/* Messages */}
      <div className={styles.chatMessages} ref={messagesContainerRef}>
        {messages.map(msg => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className={styles.msgRowUser}>
                <div className={styles.bubbleUser}>{msg.text}</div>
              </div>
            );
          }

          const bot = msg as BotMessage;

          if (bot.kind === 'loading') {
            return (
              <div key={bot.id} className={styles.msgRowBot}>
                <span className={styles.botAvatar}>🤖</span>
                <div className={styles.bubbleBot}>
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                  <span className={styles.typingDot} />
                </div>
              </div>
            );
          }

          if (bot.kind === 'text') {
            const isGreeting = bot.text === GREETING;
            return (
              <div key={bot.id} className={styles.msgRowBot}>
                <span className={styles.botAvatar}>🤖</span>
                <div className={styles.bubbleBot}>
                  {bot.text}
                  {!isGreeting && <SupportLink />}
                </div>
              </div>
            );
          }

          // results
          return (
            <div key={bot.id} className={styles.msgRowBot}>
              <span className={styles.botAvatar}>🤖</span>
              <div className={styles.bubbleBotResults}>
                {bot.answer && (
                  <div className={styles.resultsAnswer}>
                    {bot.answer.split('\n').map((line, i) => (
                      <p key={i} className={styles.answerLine}>{renderInline(line)}</p>
                    ))}
                  </div>
                )}
                {bot.results.length > 0 && (
                  <>
                    <p className={styles.linksLabel}>📎 Saiba mais:</p>
                    <div className={styles.resultCards}>
                      {bot.results.map((r, i) => (
                        <Link key={i} to={r.page.url} className={styles.resultCard}>
                          <span className={styles.resultIcon}>{SECTION_ICON[r.page.section] ?? '📄'}</span>
                          <span className={styles.resultBody}>
                            <span className={styles.resultSection}>{r.page.section}</span>
                            <span className={styles.resultTitle}>{r.page.title}</span>
                          </span>
                          <span className={styles.resultCta}>Abrir →</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
                <SupportLink />
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div className={styles.chatInputRow}>
        <input
          ref={inputRef}
          className={styles.chatInput}
          type="text"
          placeholder="Digite sua dúvida..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          disabled={loading}
        />
        <button
          className={styles.chatSendBtn}
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label="Enviar"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

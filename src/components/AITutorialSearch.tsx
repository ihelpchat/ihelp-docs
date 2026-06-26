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

type SearchResult = {page: ContentPage};

type BotMessage =
  | {id: string; role: 'bot'; kind: 'text'; text: string}
  | {id: string; role: 'bot'; kind: 'results'; explanation: string; results: SearchResult[]}
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

function keywordSearch(query: string, pages: ContentPage[]): SearchResult[] {
  const words = normalize(query).split(/\s+/).filter(w => w.length >= 3).map(stem);
  if (words.length === 0) return [];
  const scored = pages.map(page => {
    let score = 0;
    const titleStems = normalize(page.title).split(/\s+/).map(stem);
    const headingStems = (page.headings ?? []).join(' ').split(/\s+/).map(w => stem(normalize(w)));
    for (const word of words) {
      if (titleStems.some(t => wordsMatch(t, word))) score += 2;
      if (headingStems.some(h => wordsMatch(h, word))) score += 1;
    }
    return {page, score};
  });
  return scored.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(r => ({page: r.page}));
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
    body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 500, system, messages}),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.content[0].text;
}

let _id = 0;
const uid = () => String(++_id);

const GREETING = 'Olá! Como posso te ajudar hoje?';

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

  const [messages, setMessages] = useState<Message[]>([
    {id: uid(), role: 'bot', kind: 'text', text: GREETING},
  ]);
  const [claudeHistory, setClaudeHistory] = useState<ClaudeMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const pagesRef = useRef<ContentPage[]>([]);
  const pageListRef = useRef('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(indexUrl)
      .then(r => r.json())
      .then((data: ContentPage[]) => {
        pagesRef.current = data;
        pageListRef.current = data.map((p, i) => `${i}. [${p.section}] ${p.title}`).join('\n');
      })
      .catch(() => {});
  }, [indexUrl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages]);

  function addMessage(msg: Message) {
    setMessages(prev => {
      // Remove loading bubble before adding real response
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

    try {
      if (apiKey && pages.length > 0) {
        const system = `Você é um assistente simpático da documentação iHelp. Analise a dúvida do usuário e tome UMA decisão:

1. Se a dúvida for clara: retorne os melhores resultados da lista.
2. Se for vaga ou ambígua: faça UMA pergunta curta e objetiva para qualificar melhor.

Responda APENAS em JSON, sem texto extra:
- Para qualificar: {"type":"question","question":"<pergunta curta e amigável em português>"}
- Com resultados: {"type":"results","indices":[n,n,n],"explanation":"<frase curta e amigável>"}

Páginas disponíveis:
${pageListRef.current}`;

        const text = await callClaude(apiKey, newClaudeHistory, system);

        if (text) {
          const parsed = JSON.parse(text);

          if (parsed.type === 'question') {
            const assistantContent = parsed.question as string;
            setClaudeHistory([...newClaudeHistory, {role: 'assistant', content: assistantContent}]);
            addMessage({id: uid(), role: 'bot', kind: 'text', text: assistantContent});
            return;
          }

          if (parsed.type === 'results') {
            const results: SearchResult[] = (parsed.indices as number[])
              .filter((i: number) => i >= 0 && i < pages.length)
              .slice(0, 3)
              .map((i: number) => ({page: pages[i]}));
            setClaudeHistory([...newClaudeHistory, {role: 'assistant', content: parsed.explanation || ''}]);
            addMessage({id: uid(), role: 'bot', kind: 'results', explanation: parsed.explanation || '', results});
            return;
          }
        }
      }

      // Fallback: busca por palavras-chave
      setClaudeHistory(newClaudeHistory);
      const results = pages.length > 0 ? keywordSearch(q, pages) : [];
      if (results.length === 0) {
        addMessage({id: uid(), role: 'bot', kind: 'text', text: 'Não encontrei resultados para essa busca. Pode tentar outros termos?'});
      } else {
        addMessage({id: uid(), role: 'bot', kind: 'results', explanation: 'Encontrei estas páginas que podem te ajudar:', results});
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
      <div className={styles.chatMessages}>
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
            return (
              <div key={bot.id} className={styles.msgRowBot}>
                <span className={styles.botAvatar}>🤖</span>
                <div className={styles.bubbleBot}>{bot.text}</div>
              </div>
            );
          }

          // results
          return (
            <div key={bot.id} className={styles.msgRowBot}>
              <span className={styles.botAvatar}>🤖</span>
              <div className={styles.bubbleBotResults}>
                {bot.explanation && <p className={styles.resultsExplanation}>💡 {bot.explanation}</p>}
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
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
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

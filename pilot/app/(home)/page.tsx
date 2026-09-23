import Link from 'next/link';
import { ChevronRight, CircleHelp, MessageCircle, Terminal, Sparkles } from 'lucide-react';
import { AskButton, HomeSearch } from '@/components/home-search';
import { getNews } from '@/lib/news';
import { nodeText } from '@/lib/react-text';
import { getSiteCounts } from '@/lib/site';
import { source } from '@/lib/source';
import { supportPhone, supportUrl } from '@/lib/links';
import { withBasePath } from '@/lib/shared';

const startHere = [
  ['01', 'Acessar a plataforma', 'Primeiro login, senha e permissões', '/docs/primeiros-passos/acessando-a-plataforma'],
  ['02', 'Montar filas e departamentos', 'Como o atendimento é distribuído', '/docs/sobre-o-sistema/configuracoes/departamentos'],
  ['03', 'Primeira chamada na API', 'Token, base URL e envio de mensagem', '/api'],
  ['04', 'Migrar para a API oficial', 'O que muda no número e nos custos', '/docs/whatsapp-business-api/antes-de-migrar'],
] as const;

function topQuestions() {
  const faq = source.getPage(['docs', 'principais-duvidas']);
  if (!faq) return [];
  return faq.data.toc
    .filter((item) => item.depth === 3)
    .slice(0, 5)
    .map((item) => ({ title: nodeText(item.title).replace(/^\s*\d+\.\s*/, ''), href: `${faq.url}${item.url}` }));
}

export default function HomePage() {
  const counts = getSiteCounts();
  const news = getNews().slice(0, 3);
  const assistantEnabled = Boolean(process.env.NEXT_PUBLIC_ASSISTANT_URL);

  return (
    <main className="design-home">
      <section className="design-hero">
        <div className="design-hero-pattern" style={{ backgroundImage: `url('${withBasePath('/brand/bg-chat.png')}')` }} aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="design-hero-art" src={withBasePath('/brand/illustration-chat.svg')} alt="" width={440} height={330} />
        <div className="design-container design-hero-content">
          <span className="design-badge">
            <Sparkles aria-hidden="true" />
            {assistantEnabled ? 'Assistente GPT conectado à documentação do iHelp' : 'Busca inteligente em toda a documentação do iHelp'}
          </span>
          <h1>Tire sua dúvida sobre o iHelp em uma pergunta.</h1>
          <p>Central de ajuda para o dia a dia do atendimento e referência técnica da API — no mesmo lugar, com busca que entende o que você quer.</p>
          <HomeSearch />
        </div>
      </section>

      <div className="design-container">
        <section className="design-portals" aria-label="Áreas da documentação">
          <Link className="design-portal-card" href="/docs">
            <span className="design-icon"><MessageCircle aria-hidden="true" /></span>
            <h2>Central de ajuda</h2>
            <p>Atendimento, campanhas, CRM, robôs e configurações. Para quem usa o iHelp todos os dias.</p>
            <div className="design-tags"><span>Atendimento</span><span>Campanhas</span><span>WhatsApp oficial</span><span>+{counts.articles} artigos</span></div>
            <strong>Acessar a ajuda <ChevronRight aria-hidden="true" /></strong>
          </Link>
          <Link className="design-portal-card design-portal-api" href="/api">
            <span className="design-icon"><Terminal aria-hidden="true" /></span>
            <h2>Referência da API</h2>
            <p>Autenticação, atendimentos, mensagens, templates da Meta e CRM. Exemplos de requisição com resposta real.</p>
            <div className="design-tags design-tags-mono"><span data-method="GET">GET</span><span data-method="POST">POST</span><span>{counts.endpoints} endpoints</span></div>
            <strong>Ver a API <ChevronRight aria-hidden="true" /></strong>
          </Link>
        </section>

        <section className="design-section" aria-labelledby="start-title">
          <header><h2 id="start-title">Comece por aqui</h2><Link href="/tutoriais">Ver todos os tutoriais</Link></header>
          <div className="design-start-grid">
            {startHere.map(([number, title, meta, href]) => (
              <Link href={href} key={href}><span>{number}</span><div><strong>{title}</strong><p>{meta}</p></div></Link>
            ))}
          </div>
        </section>

        <section className="design-info-grid">
          <div className="design-list-card">
            <header><h2>Dúvidas mais buscadas</h2><Link href="/docs/principais-duvidas">Ver FAQ</Link></header>
            {topQuestions().map(({ title, href }) => (
              <Link href={href} key={href}><CircleHelp aria-hidden="true" /><span>{title}</span><ChevronRight aria-hidden="true" /></Link>
            ))}
          </div>
          <div className="design-list-card design-news">
            <header><h2>Novidades do produto</h2><Link href="/blog">Ver tudo</Link></header>
            {news.map((entry) => (
              <Link href={entry.url} key={entry.url}>
                <time dateTime={entry.date}>{entry.dateLabel}</time>
                <span><strong>{entry.title}</strong><small>{entry.tag}</small></span>
              </Link>
            ))}
          </div>
        </section>

        <section className="design-support">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath('/brand/illustration-sync.svg')} alt="" width={168} height={118} />
          <div>
            <h2>Não achou o que precisava?</h2>
            <p>Fale com o suporte pelo {supportPhone} ou abra um atendimento direto no app. Respondemos em horário comercial.</p>
          </div>
          <div>
            <a href={supportUrl} target="_blank" rel="noreferrer noopener">Falar com o suporte</a>
            <AskButton>{assistantEnabled ? 'Perguntar ao assistente' : 'Buscar na documentação'}</AskButton>
          </div>
        </section>

        <footer className="design-footer">
          <span>© 2026 iHelp · Documentação</span>
          <nav aria-label="Rodapé">
            <a href="https://ihelpchat.com.br">Site</a>
            <Link href="/blog">Novidades</Link>
            <a href={supportUrl} target="_blank" rel="noreferrer noopener">Suporte</a>
          </nav>
        </footer>
      </div>
    </main>
  );
}

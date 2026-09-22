import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  CircleHelp,
  Code2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { HomeSearch } from '@/components/home-search';
import { withBasePath } from '@/lib/shared';

const startHere = [
  ['01', 'Acessando a plataforma', 'Primeiros passos', '/docs/primeiros-passos/acessando-a-plataforma'],
  ['02', 'Meus primeiros atendimentos', 'Atendimento', '/docs/sobre-o-sistema/atendimento'],
  ['03', 'Primeiro número na API', 'WhatsApp oficial', '/docs/whatsapp-business-api'],
  ['04', 'Minha primeira API', 'Integrações', '/api'],
] as const;

const questions = [
  ['Como transferir um atendimento?', '/docs/sobre-o-sistema/atendimento'],
  ['Como criar e gerenciar usuários?', '/docs/sobre-o-sistema/configuracoes/gerenciamento-de-usuarios'],
  ['Como conectar ou reconectar um canal?', '/docs/sobre-o-sistema/configuracoes/canais'],
  ['Quanto custa a API oficial?', '/docs/whatsapp-business-api/quanto-custa'],
  ['Como preparar uma campanha?', '/docs/sobre-o-sistema/campanhas/preparando-a-planilha-de-campanhas'],
] as const;

const news = [
  ['24 abr', 'Nova tela de alteração de senha', 'Segurança', '/blog/nova-tela-de-senha'],
  ['23 jul', 'Encerramento automático e novos filtros', 'Atendimento', '/blog/encerramento-automatico-e-filtros'],
  ['30 jun', 'Listas personalizadas', 'Atendimento', '/blog/listas-personalizadas'],
] as const;

export default function HomePage() {
  return (
    <main className="design-home">
      <section className="design-hero">
        <div className="design-hero-pattern" style={{ backgroundImage: `url('${withBasePath('/brand/bg-chat.png')}')` }} aria-hidden="true" />
        <Image className="design-hero-art" src={withBasePath('/brand/illustration-chat.svg')} alt="" width={440} height={330} priority />
        <div className="design-container design-hero-content">
          <span className="design-badge">
            <Sparkles aria-hidden="true" />
            Assistente de IA treinado na documentação do iHelp
          </span>
          <h1>Tire sua dúvida sobre o iHelp em uma pergunta.</h1>
          <p>Central de ajuda para o dia a dia do atendimento e referência técnica da API — no mesmo lugar, com busca que entende o que você quer.</p>
          <HomeSearch />
        </div>
      </section>

      <div className="design-container design-content">
        <section className="design-portals" aria-label="Áreas da documentação">
          <Link className="design-portal-card" href="/docs">
            <span className="design-icon"><MessageCircle aria-hidden="true" /></span>
            <h2>Central de ajuda</h2>
            <p>Atendimento, campanhas, CRM, robôs e configurações. Para quem usa o iHelp todos os dias.</p>
            <div className="design-tags"><span>Atendimento</span><span>Campanhas</span><span>WhatsApp oficial</span><span>+38 artigos</span></div>
            <strong>Acessar a ajuda <ArrowRight aria-hidden="true" /></strong>
          </Link>
          <Link className="design-portal-card design-portal-api" href="/api">
            <span className="design-icon"><Code2 aria-hidden="true" /></span>
            <h2>Referência da API</h2>
            <p>Autenticação, atendimentos, mensagens, templates da Meta e CRM. Exemplos com payloads e respostas.</p>
            <div className="design-tags"><span>GET</span><span>POST</span><span>23 endpoints</span></div>
            <strong>Ver a API <ArrowRight aria-hidden="true" /></strong>
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
            {questions.map(([title, href]) => <Link href={href} key={title}><CircleHelp aria-hidden="true" /><span>{title}</span><ArrowRight aria-hidden="true" /></Link>)}
          </div>
          <div className="design-list-card design-news">
            <header><h2>Novidades do produto</h2><Link href="/blog">Ver tudo</Link></header>
            {news.map(([date, title, tag, href]) => <Link href={href} key={title}><time>{date}</time><span><strong>{title}</strong><small>{tag}</small></span></Link>)}
          </div>
        </section>

        <section className="design-support">
          <Image src={withBasePath('/brand/illustration-sync.svg')} alt="" width={120} height={84} />
          <div><h2>Não achou o que precisava?</h2><p>Fale com o suporte pelo (17) 3042-2307 ou abra um atendimento direto no app. Respondemos em horário comercial.</p></div>
          <div><a href="https://wa.me/551730422307">Falar com o suporte</a><Link href="/docs">Perguntar ao assistente</Link></div>
        </section>

        <footer className="design-footer"><span>© 2026 iHelp · Documentação</span><nav><a href="https://ihelpchat.com.br">Site</a><Link href="/blog">Novidades</Link><a href="https://wa.me/551730422307">Suporte</a></nav></footer>
      </div>
    </main>
  );
}

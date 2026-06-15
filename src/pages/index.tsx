import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type CardItem = {
  title: string;
  emoji: string;
  description: string;
  to: string;
  cta: string;
};

const CARDS: CardItem[] = [
  {
    title: 'Central de Ajuda',
    emoji: '💬',
    description:
      'Tire suas dúvidas sobre atendimento, campanhas, configurações e o dia a dia do iHelp.',
    to: '/docs',
    cta: 'Acessar ajuda',
  },
  {
    title: 'Documentação de API',
    emoji: '🔌',
    description:
      'Endpoints, autenticação e exemplos para integrar sistemas com a API do iHelp.',
    to: '/api',
    cta: 'Ver API',
  },
  {
    title: 'Novidades',
    emoji: '✨',
    description:
      'Acompanhe as últimas atualizações, melhorias e recursos lançados no iHelp.',
    to: '/blog',
    cta: 'Ver novidades',
  },
];

function HomeHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
      </div>
    </header>
  );
}

function Cards() {
  return (
    <section className={styles.cards}>
      <div className="container">
        <div className="row">
          {CARDS.map((card) => (
            <div key={card.title} className="col col--4">
              <Link to={card.to} className={styles.card}>
                <span className={styles.cardEmoji}>{card.emoji}</span>
                <Heading as="h2" className={styles.cardTitle}>
                  {card.title}
                </Heading>
                <p className={styles.cardDescription}>{card.description}</p>
                <span className={styles.cardCta}>{card.cta} →</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Central de Ajuda, Documentação de API e Novidades do iHelp.">
      <HomeHeader />
      <main>
        <Cards />
      </main>
    </Layout>
  );
}

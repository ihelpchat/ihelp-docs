import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Documentação iHelp',
  tagline: 'Central de Ajuda, API e Novidades do iHelp',
  favicon: 'img/favicon.ico',

  // Ícone SVG nítido para navegadores modernos + apple-touch-icon (iOS).
  // O favicon.ico (multi-resolução) acima cobre Safari/legados.
  headTags: [
    {
      tagName: 'link',
      attributes: {rel: 'icon', type: 'image/svg+xml', href: '/ihelp-docs/img/logo-icon.svg'},
    },
    {
      tagName: 'link',
      attributes: {rel: 'apple-touch-icon', href: '/ihelp-docs/img/apple-touch-icon.png'},
    },
  ],

  future: {
    v4: true,
  },

  customFields: {
    claudeApiKey: process.env.CLAUDE_API_KEY ?? '',
  },

  // Produção: GitHub Pages do projeto
  url: 'https://ihelpchat.github.io',
  baseUrl: '/ihelp-docs/',

  organizationName: 'ihelpchat',
  projectName: 'ihelp-docs',
  trailingSlash: false,

  // Durante a migração usamos 'warn' para conseguir builds iterativos;
  // a Fase 7 (verificação final) volta para 'throw'.
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
      onBrokenMarkdownImages: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          // Central de Ajuda (instância padrão)
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
        },
        blog: {
          // Novidades e Atualizações
          path: 'blog',
          routeBasePath: 'blog',
          blogTitle: 'Novidades e Atualizações',
          blogDescription: 'Novidades, melhorias e atualizações do iHelp',
          blogSidebarTitle: 'Atualizações recentes',
          blogSidebarCount: 'ALL',
          postsPerPage: 10,
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            title: 'Novidades do iHelp',
            copyright: `Copyright © ${new Date().getFullYear()} iHelp.`,
            xslt: true,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        // Segunda instância de docs: Documentação de API
        id: 'api',
        path: 'api',
        routeBasePath: 'api',
        sidebarPath: './sidebarsApi.ts',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        // Terceira instância de docs: Tutoriais Guiados
        id: 'tutoriais',
        path: 'tutoriais',
        routeBasePath: 'tutoriais',
        sidebarPath: './sidebarsTutoriais.ts',
      },
    ],
    [
      // Busca local (offline, funciona no GitHub Pages, suporta pt)
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['pt', 'en'],
        docsRouteBasePath: ['docs', 'api', 'tutoriais'],
        indexBlog: true,
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 8,
      },
    ],
  ],

  themeConfig: {
    image: 'img/ihelp-social-card.jpg',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      // wordmark oficial do iHelp (já contém o nome, por isso sem title)
      title: '',
      logo: {
        alt: 'iHelp',
        src: 'img/logo.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'helpSidebar',
          position: 'left',
          label: 'Central de Ajuda',
        },
        {
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          docsPluginId: 'api',
          position: 'left',
          label: 'API',
        },
        {
          type: 'docSidebar',
          sidebarId: 'tutoriaisSidebar',
          docsPluginId: 'tutoriais',
          position: 'left',
          label: 'Tutoriais Guiados',
        },
        {to: '/blog', label: 'Novidades', position: 'left'},
        {
          href: 'https://github.com/ihelpchat/ihelp-docs',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentação',
          items: [
            {label: 'Central de Ajuda', to: '/docs'},
            {label: 'API', to: '/api'},
            {label: 'Tutoriais Guiados', to: '/tutoriais'},
            {label: 'Novidades', to: '/blog'},
          ],
        },
        {
          title: 'iHelp',
          items: [
            {label: 'Site', href: 'https://ihelpchat.com'},
            {label: 'FAQ (antigo)', href: 'https://faq.ihelpchat.com'},
          ],
        },
        {
          title: 'Mais',
          items: [
            {label: 'GitHub', href: 'https://github.com/ihelpchat/ihelp-docs'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} iHelp. Feito com Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['json', 'bash', 'http'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

import { llms, loader } from 'fumadocs-core/source';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema.extend({
      description: z.string().min(20),
      source: z.enum(['produto', 'suporte', 'api']),
      contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      endpoint: z.string().optional(),
      date: z.coerce.date().optional(),
      authors: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
    // Data do último commit do arquivo (o deploy do Pages clona o histórico completo).
    lastModified: true,
  },
  meta: {
    schema: metaSchema,
  },
});

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [],
});

export const docsLlms = llms(source, {
  renderPage: async (page) => `# ${page.data.title} (${page.url})

${await page.data.getText('processed')}`,
});

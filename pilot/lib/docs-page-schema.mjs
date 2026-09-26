import { pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import { guideSchema } from '../architecture/conversation-v1.mjs';

// O mesmo schema usado pela Central e pelo teste do MDX publicado.
export const docsPageSchema = pageSchema.extend({
  description: z.string().min(20),
  source: z.enum(['produto', 'suporte', 'api']),
  contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
  guide: guideSchema.optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  endpoint: z.string().optional(),
  date: z.coerce.date().optional(),
  authors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

import { z } from 'zod/v4';
import { parseAssistantSuggestions } from './conversational-contract.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';

// Contrato único dos campos públicos lidos do MDX e aceitos pelo MCP.
export const articleSchema = z.strictObject({
  path: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.enum(['produto', 'suporte', 'api']),
  contentType: z.enum(['faq', 'tutorial', 'guia', 'referencia']),
  body: z.string(),
  guide: guideSchema.optional(),
  tangoUrl: z.string().url().optional(),
  productActions: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    label: z.string().min(3).max(80),
    route: z.string().regex(/^\/(?!\/)[a-z0-9/_-]*$/),
    target: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).optional(),
  })).max(12).optional(),
  icon: z.string().optional(),
  full: z.boolean().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  endpoint: z.string().optional(),
  date: z.string().optional(),
  authors: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  slug: z.string().optional(),
  assistantQuestion: z.string().optional(),
  assistantOverview: z.string().optional(),
  assistantInitialSteps: z.coerce.number().int().optional(),
  assistantSuggestions: z.union([z.array(z.string()), z.string().transform(parseAssistantSuggestions)]).optional(),
  assistantIntent: z.string().optional(),
  assistantResolution: z.string().optional(),
  assistantOptionalBranch: z.string().optional(),
  assistantOptionalPrompt: z.string().optional(),
  assistantOptionalResumePrompt: z.string().optional(),
  assistantOptionalBlockedPrompt: z.string().optional(),
  assistantSuccess: z.string().optional(),
});

export const articleFields = new Set(Object.keys(articleSchema.shape));
export const frontmatterFields = new Set([...articleFields].filter((key) => !['path', 'body', 'tangoUrl', 'productActions'].includes(key)));

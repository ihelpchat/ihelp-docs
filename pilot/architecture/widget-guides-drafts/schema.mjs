import { z } from 'zod/v4';
import { guideSchema } from '../conversation-v1.mjs';

// IDs novos podem ser propostos sem ampliar a allowlist do contrato publicado.
// safeExtend preserva as refinements de estrutura e grafo do guideSchema.
export const draftGuideSchema = guideSchema.safeExtend({
  guideId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/u),
});

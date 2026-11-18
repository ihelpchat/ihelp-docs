// Usage: node scripts/generated-guide-report.mjs conversations.jsonl feedback.jsonl
import { readFile } from 'node:fs/promises';
import { summarizeFeedback } from '../mcp/feedback-service.mjs';
const [conversations, feedback] = process.argv.slice(2);
if (!conversations || !feedback) throw new Error('Informe conversations.jsonl e feedback.jsonl');
const events = (await readFile(conversations, 'utf8')).split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const usage = new Map();
for (const event of events) {
  if (!/^gen-[a-f0-9]{12}$/.test(event.guideId ?? '')) continue;
  const sessions = usage.get(event.guideId) ?? new Set();
  sessions.add(event.sessionId ?? event.eventId);
  usage.set(event.guideId, sessions);
}
const ratings = await summarizeFeedback(feedback);
console.log(JSON.stringify({
  mostUsed: [...usage].map(([guideId, sessions]) => ({ guideId, sessions: sessions.size })).sort((a, b) => b.sessions - a.sessions),
  bestRated: ratings.generatedGuides.bestRated,
}, null, 2));

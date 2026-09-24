import { assistantEndpoint } from '@/lib/assistant';

export type FeedbackValue = 'up' | 'down';

type FeedbackEvent = {
  eventId: string;
  type: 'assistant' | 'article';
  value: FeedbackValue;
  path: string;
  question?: string;
  sources?: string[];
};

const feedbackEndpoint = process.env.NEXT_PUBLIC_FEEDBACK_URL?.trim()
  || assistantEndpoint.replace(/\/assistant\/?$/, '/feedback');

function eventId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function submitFeedback(event: Omit<FeedbackEvent, 'eventId'> & { eventId?: string }) {
  if (!feedbackEndpoint) return false;
  try {
    const response = await fetch(feedbackEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, eventId: event.eventId || eventId() }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

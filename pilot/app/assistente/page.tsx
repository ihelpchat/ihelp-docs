import type { Metadata } from 'next';
import { AssistantScreen } from '@/components/assistant/assistant-screen';
import { assistantDisplayName } from '@/lib/assistant-name';

export const metadata: Metadata = {
  title: assistantDisplayName,
  description: 'Pergunte sobre o iHelp e receba respostas com base na documentação, com as fontes usadas.',
};

export default function AssistantPage() {
  return <AssistantScreen />;
}

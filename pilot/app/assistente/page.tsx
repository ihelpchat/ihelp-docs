import type { Metadata } from 'next';
import { AssistantScreen } from '@/components/assistant/assistant-screen';

export const metadata: Metadata = {
  title: 'Claricia · assistente de IA do iHelp',
  description: 'Pergunte sobre o iHelp e receba respostas com base na documentação, com as fontes usadas.',
};

export default function AssistantPage() {
  return <AssistantScreen />;
}

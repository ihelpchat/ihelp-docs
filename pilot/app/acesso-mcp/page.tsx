import type { Metadata } from 'next';
import { McpSetup } from '@/components/mcp/mcp-setup';

export const metadata: Metadata = {
  title: 'Acesso ao MCP da documentação',
  description: 'Configuração reservada do servidor MCP da documentação do iHelp.',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
};

export default function McpAccessPage() {
  return <McpSetup />;
}

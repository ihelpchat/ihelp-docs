'use client';

import { Check, Clipboard, Eye, EyeOff, KeyRound, Server, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';
import { withBasePath } from '@/lib/shared';
import styles from './mcp-setup.module.css';

const endpoint = 'https://ihelp-docs-assistant-production.up.railway.app/mcp';
type Client = 'claude' | 'codex';

function shellValue(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function commandFor(client: Client, token: string) {
  const value = token.trim() || '<SUA_CHAVE_MCP>';
  if (client === 'codex') {
    return [
      `export IHELP_DOCS_MCP_TOKEN=${shellValue(value)}`,
      'launchctl setenv IHELP_DOCS_MCP_TOKEN "$IHELP_DOCS_MCP_TOKEN"',
      `codex mcp add ihelp-docs --url ${endpoint} --bearer-token-env-var IHELP_DOCS_MCP_TOKEN`,
    ].join('\n');
  }
  return `claude mcp add --transport http --scope user --header ${shellValue(`Authorization: Bearer ${value}`)} ihelp-docs ${endpoint}`;
}

export function McpSetup() {
  const [client, setClient] = useState<Client>('claude');
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const command = commandFor(client, token);
  const steps = client === 'codex'
    ? [
        'Cole a chave de acesso no campo abaixo.',
        'Clique em “Copiar comando”.',
        'Abra o Terminal do macOS.',
        'Cole o comando, pressione Enter e aguarde a confirmação.',
        'Reabra o Orca ou o Codex e peça: “Use o ihelp-docs para listar os gaps prioritários”.',
      ]
    : [
        'Cole a chave de acesso no campo abaixo.',
        'Clique em “Copiar comando”.',
        'Abra o Terminal do macOS.',
        'Cole o comando, pressione Enter e aguarde a confirmação.',
        'Reabra o Claude Code e peça: “Use o ihelp-docs para listar os gaps prioritários”.',
      ];

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.orbit} aria-hidden="true" />
      <section className={styles.shell}>
        <header className={styles.brandRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath('/brand/logo-lockup-light-on-dark.svg')} alt="iHelp" width={82} height={35} />
          <span className={styles.status}><span />Servidor online</span>
        </header>

        <div className={styles.intro}>
          <p className={styles.eyebrow}>Acesso reservado · documentação</p>
          <h1>Conecte o MCP da documentação</h1>
          <p>O servidor já está hospedado. Você só informa sua chave, copia um comando e conecta seu assistente — sem instalar pacote ou rodar <code>npm</code>.</p>
        </div>

        <div className={styles.workspace}>
          <div className={styles.clientTabs} role="group" aria-label="Cliente MCP">
            <button type="button" data-active={client === 'claude' || undefined} onClick={() => setClient('claude')}>Claude Code</button>
            <button type="button" data-active={client === 'codex' || undefined} onClick={() => setClient('codex')}>Codex</button>
          </div>

          <label className={styles.keyLabel} htmlFor="mcp-key">
            <span><KeyRound aria-hidden="true" /> Chave de acesso do MCP</span>
            <small>Receba a chave do responsável pela documentação.</small>
          </label>
          <div className={styles.keyField}>
            <input
              id="mcp-key"
              aria-label="Chave de acesso do MCP"
              type={visible ? 'text' : 'password'}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Cole a chave aqui"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar chave' : 'Mostrar chave'}>
              {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>

          <div className={styles.commandHead}>
            <span><Terminal aria-hidden="true" /> Terminal</span>
            <button type="button" onClick={copyCommand}>
              {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
              {copied ? 'Copiado' : 'Copiar comando'}
            </button>
          </div>
          <pre className={styles.command} data-mcp-command><code>{command}</code></pre>

          <section className={styles.steps} aria-live="polite">
            <h2>Passo a passo para {client === 'codex' ? 'Codex' : 'Claude Code'}</h2>
            <ol data-mcp-steps>
              {steps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}
            </ol>
          </section>
        </div>

        <aside className={styles.security}>
          <ShieldCheck aria-hidden="true" />
          <div><strong>Sua chave fica neste navegador.</strong><span>A página não envia, registra nem armazena o valor digitado. Não compartilhe a chave em chats ou documentos públicos.</span></div>
        </aside>

        <footer>
          <span><Server aria-hidden="true" /> MCP iHelp Docs · produção</span>
          <span>Uma tecnologia iHelp</span>
        </footer>
      </section>
    </main>
  );
}

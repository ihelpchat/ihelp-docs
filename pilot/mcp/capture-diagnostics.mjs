export function captureFailureCategory(error) {
  const message = String(error?.message ?? '');
  if (error?.captureReason === 'máscara não cobriu' || /máscara não cobriu/iu.test(message)) return 'máscara não cobriu';
  if (error?.captureReason === 'alvo fora da tela' || /alvo fora da tela/iu.test(message)) return 'alvo fora da tela';
  if (/tela não estabilizou/iu.test(message)) return 'tela não estabilizou';
  if (/20 passos|limite de passos/iu.test(message)) return 'limite de passos';
  if (/nenhum fato|rótulo|plano interno|rota confirmada/iu.test(message)) return 'nenhum passo com rótulo da tela';
  if (/fatos da tela|checkout|código do produto/iu.test(message)) return 'fatos da tela indisponíveis';
  if (/destino recusado|host|URL|modo e host/iu.test(message)) return 'host de QA não permitido';
  if (/login|credenciais de QA|sessão de QA|senha|password/iu.test(message)) return 'login na homologação falhou';
  return 'captura indisponível';
}

export function captureFailureLog(error, env = process.env) {
  const category = captureFailureCategory(error);
  const diagnostic = error?.diagnostic ?? error?.cause?.diagnostic;
  const detail = diagnostic ? `outcome=${diagnostic.outcome} path=${diagnostic.path} messages=${diagnostic.messages.join(' | ')} requests=${diagnostic.requests.map((entry) => typeof entry === 'string' ? entry : `${entry.method} ${entry.path} ${entry.status}`).join(' | ')} failed=${(diagnostic.failed ?? []).join(' | ')} controls=${diagnostic.controls.join(' | ')}`
    : String(error?.cause?.message ?? error?.message ?? '').split(/\r?\n/u, 1)[0];
  let safe = detail.split(/\r?\n/u, 1)[0]
    .replace(/\b(?:cookie|set-cookie|authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/giu, '[cabeçalho removido]')
    .replace(/\bBearer\s+\S+/giu, '[segredo removido]')
    .replace(/\bCfDJ8[A-Za-z0-9_+\/-]*/gu, '[segredo removido]')
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/gu, '[segredo removido]')
    .replace(/\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '[segredo removido]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[URL removida]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[e-mail removido]');
  for (const [key, value] of Object.entries(env)) {
    if (!/(?:PASSWORD|TOKEN|SECRET|API_KEY|EMAIL)/iu.test(key) || typeof value !== 'string' || value.length < 4) continue;
    safe = safe.replaceAll(value, '[segredo removido]');
  }
  return `capturar_telas: ${category}: ${safe.slice(0, 700)}`;
}

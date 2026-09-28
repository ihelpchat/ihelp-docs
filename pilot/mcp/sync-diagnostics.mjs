export function safeSyncError(error, token) {
  const lines = String(error?.stderr || error?.message || error).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const first = lines.find((line) => /^(?:fatal|error):/iu.test(line)) ?? lines[0] ?? 'erro sem detalhes';
  return first.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/giu, '[URL]')
    .replace(/(?:AUTHORIZATION|authorization)\s*:\s*(?:basic|bearer)\s+[^\s'"<>]+/gu, '[autorização]')
    .replace(/\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/giu, '[email]')
    .replaceAll(token || '\0', '[credencial]')
    .slice(0, 300);
}

// Shared process lifecycle waits for HTTP integration tests. Readiness is emitted
// only by listen's callback; never probe /health here (it runs a provider self-check).
export const processTimeoutMs = Number(process.env.MCP_TEST_PROCESS_TIMEOUT_MS ?? 180_000);
if (!Number.isFinite(processTimeoutMs) || processTimeoutMs <= 0) throw new Error('Invalid MCP_TEST_PROCESS_TIMEOUT_MS');

export function waitForMcpStartup(child, { expectExit = false, timeoutMs = processTimeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let stderr = '';
    const finish = (error) => {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else {
        console.error(`[mcp-test] ${expectExit ? 'exited' : 'listening'} after ${Math.round(performance.now() - started)} ms`);
        resolve({ stderr, exitCode: child.exitCode });
      }
    };
    const onData = chunk => {
      stderr += chunk;
      if (/MCP ouvindo na porta \d+/.test(stderr)) {
        finish(expectExit ? new Error('MCP started when configuration should be rejected') : null);
      }
    };
    const onExit = (code, signal) => finish(expectExit && code !== null
      ? null : new Error(`MCP exited before readiness (${code ?? signal}): ${stderr}`));
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error(`MCP startup exceeded ${timeoutMs} ms: ${stderr}`)), timeoutMs);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
    if (child.exitCode !== null) onExit(child.exitCode);
  });
}

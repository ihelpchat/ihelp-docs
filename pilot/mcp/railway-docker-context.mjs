export function validateRailwayDockerContext(dockerfile, railwayignore) {
  const errors = [];
  const ignored = railwayignore.split(/\r?\n/u).map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  for (const line of dockerfile.split(/\r?\n/u)) {
    if (/^\s*VOLUME\b/iu.test(line)) errors.push('Dockerfile.mcp: VOLUME não é suportado pelo Railway');
    const source = /^\s*COPY\s+(\S+)\s+\S+/iu.exec(line)?.[1];
    if (!source || source.startsWith('--')) continue;
    const path = source.replace(/^\.\//u, '').replace(/\/$/u, '');
    if (ignored.some((pattern) => {
      const normalized = pattern.replace(/^\/?/u, '').replace(/\/$/u, '');
      return path === normalized || path.startsWith(`${normalized}/`);
    })) errors.push(`Dockerfile.mcp: COPY ${path} ignorado pelo .railwayignore`);
  }
  return errors;
}

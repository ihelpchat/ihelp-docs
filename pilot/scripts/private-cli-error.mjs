// O stderr de scripts que leem feedback privado nunca recebe erros crus de
// provider, JSON ou filesystem: eles podem conter texto e caminhos privados.
export class PrivateCliError extends Error {
  constructor(category, index) {
    super(`${category}${index === undefined ? '' : `: caso #${index}`}`);
    this.name = 'PrivateCliError';
  }
}

export function installPrivateCliErrorHandler() {
  process.on('uncaughtException', (error) => {
    console.error(error instanceof PrivateCliError ? error.message : 'falha de execução privada');
    process.exitCode = 1;
  });
}

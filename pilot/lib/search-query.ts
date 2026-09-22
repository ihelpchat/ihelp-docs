let pending: string | undefined;

/** Guarda uma pergunta para a busca abrir já preenchida. */
export function setPendingQuery(value: string) {
  pending = value;
}

export function takePendingQuery() {
  const value = pending;
  pending = undefined;
  return value;
}

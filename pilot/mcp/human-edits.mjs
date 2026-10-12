// Implementado no commit GREEN.
export async function reconcileHumanUpdate(_root, _path, proposed) {
  return { status: 'update', content: proposed, notice: '' };
}

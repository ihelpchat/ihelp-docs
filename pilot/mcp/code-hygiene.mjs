export function sanitizeCodeForModel(source) {
  return { text: String(source ?? ''), literalsOmitted: 0, commentsRemoved: 0 };
}

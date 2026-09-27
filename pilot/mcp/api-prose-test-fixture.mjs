// Convert old API test fixtures at the provider boundary; production rejects the old schema.
export function apiProseFixture(output) {
  if (!Array.isArray(output?.articles)) return output;
  const { grounding = [], ...rest } = output;
  const summary = typeof output.summary === 'string'
    ? [{ text: output.summary, citations: grounding.find((claim) => claim.text === output.summary)?.citations ?? [] }]
    : output.summary;
  return { ...rest, summary, articles: output.articles.map((article) => {
    if (!article || !/^api\//u.test(article.path ?? '') || typeof article.description !== 'string') return article;
    const claims = article.grounding ?? [];
    const unit = (text) => ({ text, citations: claims.find((claim) => claim.text === text)?.citations ?? [] });
    const { grounding: _grounding, ...rest } = article;
    return { ...rest, description: unit(article.description), intro: unit(article.intro),
      notas: article.notas.map(unit), responseDescriptions: article.responseDescriptions?.map((item) => {
        const { grounding: fieldGrounding = [], ...field } = item;
        return { ...field, description: { text: item.description,
          citations: fieldGrounding.find((claim) => claim.text === item.description)?.citations ?? [] } };
      }) ?? [] };
  }) };
}

export function routeMatches(cited, effective) {
  const requested = cited.toLowerCase().split('/').filter(Boolean);
  const actual = effective.toLowerCase().split('/').filter(Boolean);
  return requested.length === actual.length && actual.every((segment, index) =>
    /^\{[^}]+\}$/u.test(segment) ? Boolean(requested[index]) : segment === requested[index]);
}

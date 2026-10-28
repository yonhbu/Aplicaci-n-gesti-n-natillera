// Return locations only. A security report must never echo the matched userinfo.
export function postgresCredentialLocations(source) {
  const pattern = /postgres(?:ql)?:\/\/[^/\s"'`@]+:[^@\s"'`]+@/g;
  return [...source.matchAll(pattern)].map(match => ({
    line: source.slice(0, match.index).split('\n').length
  }));
}

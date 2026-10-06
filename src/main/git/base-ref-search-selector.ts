export function isQualifiedBaseRef(refName: string): boolean {
  return refName.startsWith('refs/heads/') || refName.startsWith('refs/remotes/')
}

export function resolveBaseRefSearchSelector(fullRef: string, shortRef: string): string {
  const parts = /^refs\/(heads|remotes)\/(.+)$/.exec(fullRef)
  if (!parts) {
    return fullRef
  }
  const namespaceName = `${parts[1]}/${parts[2]}`
  const naturalName = parts[2]
  // Full selectors preserve identity when Git disambiguates or corrupts a short name.
  if (shortRef === namespaceName || ![fullRef, namespaceName, naturalName].includes(shortRef)) {
    // Git can shorten a nested remote branch ending in /HEAD via its DWIM rules.
    if (
      parts[1] === 'remotes' &&
      naturalName.endsWith('/HEAD') &&
      shortRef === naturalName.slice(0, -'/HEAD'.length)
    ) {
      return naturalName
    }
    return fullRef
  }
  // A remote named refs/heads must not impersonate a fully qualified local selector.
  return parts[1] === 'remotes' && shortRef.startsWith('refs/heads/') ? fullRef : shortRef
}

export function boundedPlainText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  let result = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    result += code <= 31 || code === 127 ? ' ' : character
    if (result.length >= maxLength) break
  }
  return result.slice(0, maxLength)
}

export function isSecretLikeSettingKey(key: string): boolean {
  return /(?:api[-_.]?key|secret|token|password|credential|cookie|authorization)/i.test(key)
}

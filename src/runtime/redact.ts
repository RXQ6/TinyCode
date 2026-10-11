export function redactText(text: string): string {
  let result = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && value && value.length >= 6) result = result.split(value).join('[REDACTED]');
  }
  return result.replace(/\b(?:sk-|sk_)[a-zA-Z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret|token)\s*[=:]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]');
}
export function sanitize<T>(value: T): T {
  // JSON-compatible contracts only. Serialization both detaches state and strips secrets.
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (/(?:apiKey|password|secret|accessToken)/i.test(key)) return '[REDACTED]';
    return typeof item === 'string' ? redactText(item).slice(0, 24000) : item;
  })) as T;
}

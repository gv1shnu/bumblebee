export const phraseKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim()

export type GrammarCache = {
  get: (text: string) => string
  set: (params: { text: string, grammar: string }) => void
  clear: () => void
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

export const GrammarCache = (): GrammarCache => {
  const cache: Record<string, string> = {}

  const get = (text: string) => {
    const key = normalizeText(text)
    return cache[key] || ""
  }

  const set = (params: { text: string, grammar: string }) => {
    const key = normalizeText(params.text)
    const normalizedGrammar = params.grammar.trim()

    if (!key || !normalizedGrammar) {
      return
    }

    cache[key] = normalizedGrammar
  }

  const clear = () => {
    Object.keys(cache).forEach((key) => {
      delete cache[key]
    })
  }

  return {
    get,
    set,
    clear
  }
}

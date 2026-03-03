import { WordDefinition } from "@piggo-translate/core"
import { normalizeDefinition } from "../utils/TextUtils"

const getUniqueDefinitionWords = (words: string[]) =>
  Array.from(new Set(words.map((word) => normalizeDefinition(word)).filter(Boolean)))

export type Cache = {
  getCachedDefinitions: (words: string[]) => WordDefinition[]
  getMissingDefinitionWords: (words: string[]) => string[]
  writeDefinitionsToCache: (definitions: WordDefinition[]) => void
  clear: () => void
}

export const Cache = (maxItems = 10): Cache => {
  const cache: Record<string, string> = {}
  let cacheOrder: string[] = []

  const getCachedDefinitions = (words: string[]) => {
    const uniqueWords = getUniqueDefinitionWords(words)
    return uniqueWords
      .map((word) => ({
        word,
        definition: cache[word] || ""
      }))
      .filter((entry) => !!entry.definition)
  }

  const getMissingDefinitionWords = (words: string[]) => {
    const uniqueWords = getUniqueDefinitionWords(words)
    const cachedWordSet = new Set(getCachedDefinitions(uniqueWords).map((entry) => entry.word))
    return uniqueWords.filter((word) => !cachedWordSet.has(word))
  }

  const writeDefinitionsToCache = (definitions: WordDefinition[]) => {
    definitions.forEach(({ word, definition }) => {
      const normalizedWord = normalizeDefinition(word)

      if (!normalizedWord || !definition) {
        return
      }

      cache[normalizedWord] = definition
      cacheOrder = cacheOrder.filter((cachedWord) => cachedWord !== normalizedWord)
      cacheOrder.push(normalizedWord)

      while (cacheOrder.length > maxItems) {
        const oldestWord = cacheOrder.shift()

        if (!oldestWord) {
          return
        }

        delete cache[oldestWord]
      }
    })
  }

  const clear = () => {
    cacheOrder = []
    Object.keys(cache).forEach((word) => {
      delete cache[word]
    })
  }

  return {
    getCachedDefinitions,
    getMissingDefinitionWords,
    writeDefinitionsToCache,
    clear
  }
}

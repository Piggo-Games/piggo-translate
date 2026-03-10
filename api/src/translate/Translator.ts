import { WordDefinition, WordToken } from "@piggo-translate/core"

export type Translator = {
  translate: (text: string, targetLanguage: string) => Promise<{
    words: WordToken[]
  }>
  getDefinitions: (words: string[], targetLanguage: string, context: string) => Promise<WordDefinition[]>
  getGrammar: (text: string, targetLanguage: string) => Promise<string>
  getAudio: (text: string, targetLanguage: string) => Promise<Blob>
}

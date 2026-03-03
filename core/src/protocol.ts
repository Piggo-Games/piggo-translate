export type WsClientMessage = WsRequest | WsDefinitionsRequest | WsAudioRequest | WsGrammarRequest
export type WsServerMessage = WsReady | WsSuccess | WsDefinitionsSuccess | WsAudioSuccess | WsGrammarSuccess | WsError

export type WordToken = {
  word: string
  literal: string
  punctuation: boolean
}

export type WsRequest = {
  type: "translate.request"
  requestId: string
  text: string
  targetLanguage: string
}

export type WordDefinition = {
  word: string
  definition: string
}

export type WsDefinitionsRequest = {
  type: "translate.definitions.request"
  requestId: string
  word: string
  context: string
  targetLanguage: string
}

export type WsAudioRequest = {
  type: "translate.audio.request"
  requestId: string
  text: string
  targetLanguage: string
}

export type WsGrammarRequest = {
  type: "translate.grammar.request"
  requestId: string
  text: string
  targetLanguage: string
}

export type WsReady = {
  type: "ready"
}

export type WsSuccess = {
  type: "translate.success"
  requestId: string
  words: WordToken[]
}

export type WsDefinitionsSuccess = {
  type: "translate.definitions.success"
  requestId: string
  definitions: WordDefinition[]
}

export type WsAudioSuccess = {
  type: "translate.audio.success"
  requestId: string
  audioBase64: string
  mimeType: string
}

export type WsGrammarSuccess = {
  type: "translate.grammar.success"
  requestId: string
  grammar: string
}

export type WsError = {
  type: "translate.error"
  requestId?: string
  error: string
}

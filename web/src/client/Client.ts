import {
  Model, WsAudioRequest, WsDefinitionsRequest, WsRequest, WsServerMessage, WordDefinition, WordToken
} from "@piggo-translate/core"
import { isLocal, normalizeDefinition } from "@piggo-translate/web"

export type RequestSnapshot = {
  id: string
  normalizedInputText: string
}

export type TranslateRequestInput = {
  text: string
  targetLanguage: string
  model: Model
}

export type DefinitionsRequestInput = {
  word: string
  context: string
  targetLanguage: string
  model: Model
}

export type ClientOptions = {
  onSocketOpenChange: (isOpen: boolean) => void
  onErrorTextChange: (errorText: string) => void
  onTranslatingChange: (isTranslating: boolean) => void
  onDefinitionLoadingChange: (isLoading: boolean) => void
  onLatestRequestChange: (snapshot: RequestSnapshot) => void
  onTranslateSuccess: (words: WordToken[]) => void
  onTranslateError: (errorText: string) => void
  onDefinitionsSuccess: (definitions: WordDefinition[]) => void
  onDefinitionsError: () => void
  onAudioLoadingChange: (isLoading: boolean) => void
  onAudioSuccess: (audioBase64: string, mimeType: string) => void
  onAudioError: (errorText: string) => void
}

export type Client = {
  connect: () => void
  dispose: () => void
  setCurrentNormalizedInputText: (normalizedInputText: string) => void
  clearAllRequestState: () => void
  clearDefinitionRequestState: () => void
  clearAudioRequestState: () => void
  sendTranslateRequest: (requestInput: TranslateRequestInput) => void
  sendDefinitionsRequest: (requestInput: DefinitionsRequestInput) => void
  sendAudioRequest: (requestInput: { text: string, targetLanguage: string, model: Model }) => void
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

const getTranslateWsUrl = () => {
  return isLocal() ? "http://localhost:5001/api/ws" : "https://piggo-translate-production.up.railway.app/api/ws"
}

const getRequestSignature = ({ text, targetLanguage, model }: { text: string, targetLanguage: string, model: Model }) => {
  return `${model}::${normalizeText(text)}::${targetLanguage}`
}

const getDefinitionRequestSignature = (
  word: string,
  context: string,
  targetLanguage: string,
  model: Model
) => {
  return `${model}::${targetLanguage}::${normalizeDefinition(word)}::${normalizeText(context)}`
}

export const Client = (options: ClientOptions): Client => {
  let socket: WebSocket | null = null
  let reconnectTimeoutId: number | null = null
  let isDisposed = false
  let requestCounter = 0
  let latestRequest: RequestSnapshot = {
    id: "",
    normalizedInputText: ""
  }
  let currentNormalizedInputText = ""
  let lastRequestedSignature = ""
  let definitionBatchId = 0
  const definitionsRequestById = new Map<string, { signature: string, batchId: number }>()
  const definitionRequestSignaturesInFlight = new Set<string>()
  let latestAudioRequestId = ""

  const clearReconnectTimeout = () => {
    if (reconnectTimeoutId === null) {
      return
    }

    window.clearTimeout(reconnectTimeoutId)
    reconnectTimeoutId = null
  }

  const clearDefinitionRequestState = () => {
    definitionBatchId += 1
    definitionsRequestById.clear()
    definitionRequestSignaturesInFlight.clear()
    options.onDefinitionLoadingChange(false)
  }

  const clearAudioRequestState = () => {
    latestAudioRequestId = ""
    options.onAudioLoadingChange(false)
  }

  const clearAllRequestState = () => {
    latestRequest = { id: "", normalizedInputText: "" }
    options.onLatestRequestChange(latestRequest)
    currentNormalizedInputText = ""
    lastRequestedSignature = ""
    clearDefinitionRequestState()
    clearAudioRequestState()
  }

  const sendTranslateRequest = (requestInput: TranslateRequestInput) => {
    if (!requestInput.text || !socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    const requestSignature = getRequestSignature(requestInput)

    if (lastRequestedSignature === requestSignature) {
      return
    }

    requestCounter += 1
    const requestId = `${Date.now()}-${requestCounter}`

    options.onErrorTextChange("")
    options.onTranslatingChange(true)
    latestRequest = {
      id: requestId,
      normalizedInputText: normalizeText(requestInput.text)
    }
    options.onLatestRequestChange(latestRequest)
    lastRequestedSignature = requestSignature

    const request: WsRequest = {
      type: "translate.request",
      requestId,
      text: requestInput.text,
      targetLanguage: requestInput.targetLanguage
    }

    socket.send(JSON.stringify(request))
  }

  const sendDefinitionsRequest = (requestInput: DefinitionsRequestInput) => {
    const normalizedWord = normalizeDefinition(requestInput.word)
    const normalizedContext = normalizeText(requestInput.context)

    if (!normalizedWord || !normalizedContext || !socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    const requestSignature = getDefinitionRequestSignature(
      normalizedWord,
      normalizedContext,
      requestInput.targetLanguage,
      requestInput.model
    )

    if (definitionRequestSignaturesInFlight.has(requestSignature)) {
      return
    }

    requestCounter += 1
    const requestId = `${Date.now()}-${requestCounter}`
    definitionsRequestById.set(requestId, {
      signature: requestSignature,
      batchId: definitionBatchId
    })
    definitionRequestSignaturesInFlight.add(requestSignature)
    options.onDefinitionLoadingChange(true)

    const request: WsDefinitionsRequest = {
      type: "translate.definitions.request",
      requestId,
      word: normalizedWord,
      context: normalizedContext,
      targetLanguage: requestInput.targetLanguage
    }

    socket.send(JSON.stringify(request))
  }

  const sendAudioRequest = (requestInput: { text: string, targetLanguage: string, model: Model }) => {
    const normalizedText = normalizeText(requestInput.text)

    if (!normalizedText || !requestInput.targetLanguage.trim() || !socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    requestCounter += 1
    const requestId = `${Date.now()}-${requestCounter}`
    latestAudioRequestId = requestId
    options.onAudioLoadingChange(true)

    const request: WsAudioRequest = {
      type: "translate.audio.request",
      requestId,
      text: normalizedText,
      targetLanguage: requestInput.targetLanguage
    }

    socket.send(JSON.stringify(request))
  }

  const connectSocket = () => {
    clearReconnectTimeout()

    const nextSocket = new WebSocket(getTranslateWsUrl())
    console.log("Connecting to websocket at", getTranslateWsUrl())
    socket = nextSocket
    options.onSocketOpenChange(false)

    nextSocket.addEventListener("open", () => {
      if (isDisposed || socket !== nextSocket) {
        return
      }

      options.onSocketOpenChange(true)
      options.onErrorTextChange("")
    })

    nextSocket.addEventListener("message", (event) => {
      if (isDisposed || socket !== nextSocket) {
        return
      }

      let message: WsServerMessage

      try {
        message = JSON.parse(event.data) as WsServerMessage
      } catch (error) {
        options.onTranslatingChange(false)
        options.onErrorTextChange("Invalid websocket response")
        return
      }

      if (message.type === "ready") {
        return
      }

      if (message.type === "translate.definitions.success") {
        const requestState = definitionsRequestById.get(message.requestId)

        if (!requestState || requestState.batchId !== definitionBatchId) {
          return
        }

        definitionsRequestById.delete(message.requestId)
        definitionRequestSignaturesInFlight.delete(requestState.signature)
        options.onDefinitionsSuccess(message.definitions)

        if (!definitionsRequestById.size) {
          options.onDefinitionLoadingChange(false)
        }
        return
      }

      if (message.type === "translate.audio.success") {
        if (message.requestId !== latestAudioRequestId) {
          return
        }

        options.onAudioLoadingChange(false)
        options.onAudioSuccess(message.audioBase64, message.mimeType)
        return
      }

      if (
        message.type === "translate.error" &&
        message.requestId &&
        definitionsRequestById.has(message.requestId)
      ) {
        const requestState = definitionsRequestById.get(message.requestId)

        if (requestState) {
          definitionRequestSignaturesInFlight.delete(requestState.signature)
        }

        definitionsRequestById.delete(message.requestId)
        options.onDefinitionsError()

        if (!definitionsRequestById.size) {
          options.onDefinitionLoadingChange(false)
        }
        return
      }

      if (
        message.type === "translate.error" &&
        message.requestId &&
        message.requestId === latestAudioRequestId
      ) {
        options.onAudioError(message.error || "Audio generation failed")
        return
      }

      const isActiveCurrentRequest =
        !!latestRequest.id &&
        !!latestRequest.normalizedInputText &&
        !!currentNormalizedInputText &&
        currentNormalizedInputText === latestRequest.normalizedInputText &&
        (!message.requestId || message.requestId === latestRequest.id)

      if (!isActiveCurrentRequest) {
        return
      }

      options.onTranslatingChange(false)

      if (message.type === "translate.success") {
        options.onTranslateSuccess(message.words)
        options.onErrorTextChange("")
        return
      }

      if (message.type === "translate.error") {
        options.onTranslateError(message.error || "Translation failed")
      }
    })

    nextSocket.addEventListener("error", () => {
      if (isDisposed || socket !== nextSocket) {
        return
      }

      options.onSocketOpenChange(false)
    })

    nextSocket.addEventListener("close", () => {
      if (socket === nextSocket) {
        socket = null
      }

      if (isDisposed) {
        return
      }

      options.onSocketOpenChange(false)
      options.onTranslatingChange(false)
      options.onDefinitionLoadingChange(false)
      options.onAudioLoadingChange(false)
      clearAllRequestState()
      reconnectTimeoutId = window.setTimeout(() => {
        connectSocket()
      }, 500)
    })
  }

  const connect = () => {
    isDisposed = false
    connectSocket()
  }

  const dispose = () => {
    isDisposed = true
    clearReconnectTimeout()
    const activeSocket = socket
    socket = null
    options.onSocketOpenChange(false)

    if (activeSocket) {
      activeSocket.close()
    }
  }

  return {
    connect,
    dispose,
    setCurrentNormalizedInputText: (normalizedInputText: string) => {
      currentNormalizedInputText = normalizedInputText
    },
    clearAllRequestState,
    clearDefinitionRequestState,
    clearAudioRequestState,
    sendTranslateRequest,
    sendDefinitionsRequest,
    sendAudioRequest
  }
}

import { httpJson, httpText, OpenAiTranslator } from "@piggo-translate/api"

const logServerError = (context: string, error: unknown) => {
  if (error instanceof Error) {
    console.error(`[api] ${context}: ${error.message}`)

    if (error.stack) console.error(error.stack)

    return
  }

  console.error(`[api] ${context}:`, error)
}

const normalizeTranslateInput = (text: unknown, targetLanguage: unknown) => {
  const normalizedText = typeof text === "string" ? text.trim() : ""
  const normalizedTargetLanguage = typeof targetLanguage === "string" ? targetLanguage.trim() : ""

  return {
    text: normalizedText,
    targetLanguage: normalizedTargetLanguage
  }
}

const parseTranslateWsMessage = (rawMessage: unknown): { error: string } | ({
  type: "translate.request"
  requestId: string
  text: string
  targetLanguage: string
} | {
  type: "translate.definitions.request"
  requestId: string
  word: string
  context: string
  targetLanguage: string
} | {
  type: "translate.audio.request"
  requestId: string
  text: string
  targetLanguage: string
} | {
  type: "translate.grammar.request"
  requestId: string
  text: string
  targetLanguage: string
}) => {
  if (!rawMessage || typeof rawMessage !== "object") {
    return {
      error: "Invalid websocket message"
    }
  }

  const message = rawMessage as {
    type?: string
    requestId?: unknown
    text?: unknown
    targetLanguage?: unknown
    word?: unknown
    context?: unknown
  }

  if (
    message.type !== "translate.request" &&
    message.type !== "translate.definitions.request" &&
    message.type !== "translate.audio.request" &&
    message.type !== "translate.grammar.request"
  ) {
    return {
      error: "Unsupported websocket message type"
    }
  }

  if (typeof message.requestId !== "string" || !message.requestId.trim()) {
    return {
      error: "Websocket message must include a non-empty 'requestId' string"
    }
  }

  if (message.type === "translate.request") {
    const { text, targetLanguage } = normalizeTranslateInput(
      message.text, message.targetLanguage
    )

    if (!text) {
      return {
        error: "Websocket message must include a non-empty 'text' string"
      }
    }

    if (!targetLanguage) {
      return {
        error: "Websocket message must include a non-empty 'targetLanguage' string"
      }
    }

    return {
      type: "translate.request",
      requestId: message.requestId.trim(),
      text,
      targetLanguage
    }
  }

  if (message.type === "translate.audio.request") {
    const { text, targetLanguage } = normalizeTranslateInput(
      message.text,
      message.targetLanguage
    )

    if (!text) {
      return {
        error: "Websocket message must include a non-empty 'text' string"
      }
    }

    if (!targetLanguage) {
      return {
        error: "Websocket message must include a non-empty 'targetLanguage' string"
      }
    }

    return {
      type: "translate.audio.request",
      requestId: message.requestId.trim(),
      text,
      targetLanguage
    }
  }

  if (message.type === "translate.grammar.request") {
    const { text, targetLanguage } = normalizeTranslateInput(
      message.text,
      message.targetLanguage
    )

    if (!text) {
      return {
        error: "Websocket message must include a non-empty 'text' string"
      }
    }

    if (!targetLanguage) {
      return {
        error: "Websocket message must include a non-empty 'targetLanguage' string"
      }
    }

    return {
      type: "translate.grammar.request",
      requestId: message.requestId.trim(),
      text,
      targetLanguage
    }
  }

  const word = typeof message.word === "string" ? message.word.trim() : ""
  const context = typeof message.context === "string" ? message.context.trim() : ""
  const normalizedTargetLanguage =
    typeof message.targetLanguage === "string" ? message.targetLanguage.trim() : ""

  if (!word) {
    return {
      error: "Websocket message must include a non-empty 'word' string"
    }
  }

  if (!normalizedTargetLanguage) {
    return {
      error: "Websocket message must include a non-empty 'targetLanguage' string"
    }
  }

  if (!context) {
    return {
      error: "Websocket message must include a non-empty 'context' string"
    }
  }

  return {
    type: "translate.definitions.request",
    requestId: message.requestId.trim(),
    word,
    context,
    targetLanguage: normalizedTargetLanguage
  }
}

const parseWsJsonMessage = (message: string | Uint8Array | Buffer) => {
  const rawText =
    typeof message === "string" ? message : Buffer.from(message).toString("utf8")

  return JSON.parse(rawText)
}

const stripWhitespace = (value: string) => value.replace(/\s/g, "")

export const createApiServer = () => {

  const openAiTranslator = OpenAiTranslator()

  const server = Bun.serve({
    port: 5001,
    async fetch(request, serverInstance) {
      const url = new URL(request.url)

      if (request.method === "OPTIONS") {
        return httpText("", 204)
      }

      if (url.pathname === "/api") {
        return httpJson({
          status: "ok"
        })
      }

      if (url.pathname === "/api/ws") {
        const upgraded = serverInstance.upgrade(request)
        if (upgraded) return

        return httpText("WebSocket upgrade failed", 400)
      }

      return httpText("Not Found", 404)
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ type: "ready" }))
      },
      async message(ws, message) {
        let parsedJson: unknown

        try {
          parsedJson = parseWsJsonMessage(message)
        } catch (error) {
          logServerError("WS parse", error)

          ws.send(JSON.stringify({
            type: "translate.error",
            error: "Invalid JSON message"
          }))
          return
        }

        const parsedMessage = parseTranslateWsMessage(parsedJson)

        if ("error" in parsedMessage) {
          ws.send(JSON.stringify({
            type: "translate.error",
            error: parsedMessage.error
          }))
          return
        }

        if (parsedMessage.type === "translate.request") {
          try {
            const translatedOutput = await openAiTranslator.translate(
              parsedMessage.text,
              parsedMessage.targetLanguage
            )

            ws.send(JSON.stringify({
              type: "translate.success",
              requestId: parsedMessage.requestId,
              words: translatedOutput.words.map((word) => ({
                ...word,
                literal: stripWhitespace(word.literal)
              }))
            }))
          } catch (error) {
            logServerError(`WS translate ${parsedMessage.requestId}`, error)

            const messageText =
              error instanceof Error ? error.message : "Translation failed"

            ws.send(JSON.stringify({
              type: "translate.error",
              requestId: parsedMessage.requestId,
              error: messageText
            }))
          }

          return
        }

        if (parsedMessage.type === "translate.audio.request") {
          try {
            const audioBlob = await openAiTranslator.getAudio(
              parsedMessage.text,
              parsedMessage.targetLanguage
            )
            const audioBuffer = Buffer.from(await audioBlob.arrayBuffer())

            ws.send(JSON.stringify({
              type: "translate.audio.success",
              requestId: parsedMessage.requestId,
              audioBase64: audioBuffer.toString("base64"),
              mimeType: "audio/wav"
            }))
          } catch (error) {
            logServerError(`WS audio ${parsedMessage.requestId}`, error)

            const messageText =
              error instanceof Error ? error.message : "Text-to-speech failed"

            ws.send(JSON.stringify({
              type: "translate.error",
              requestId: parsedMessage.requestId,
              error: messageText
            }))
          }

          return
        }

        if (parsedMessage.type === "translate.grammar.request") {
          try {
            const grammar = await openAiTranslator.getGrammar(
              parsedMessage.text,
              parsedMessage.targetLanguage
            )

            ws.send(JSON.stringify({
              type: "translate.grammar.success",
              requestId: parsedMessage.requestId,
              grammar
            }))
          } catch (error) {
            logServerError(`WS grammar ${parsedMessage.requestId}`, error)

            const messageText =
              error instanceof Error ? error.message : "Grammar explanation failed"

            ws.send(JSON.stringify({
              type: "translate.error",
              requestId: parsedMessage.requestId,
              error: messageText
            }))
          }

          return
        }

        try {
          const definitions = await openAiTranslator.getDefinitions(
            parsedMessage.word,
            parsedMessage.targetLanguage,
            parsedMessage.context
          )

          ws.send(JSON.stringify({
            type: "translate.definitions.success",
            requestId: parsedMessage.requestId,
            definitions
          }))
        } catch (error) {
          logServerError(`WS definitions ${parsedMessage.requestId}`, error)

          const messageText =
            error instanceof Error ? error.message : "Definition lookup failed"

          ws.send(JSON.stringify({
            type: "translate.error",
            requestId: parsedMessage.requestId,
            error: messageText
          }))
        }
      }
    }
  })

  console.log(`API server running at ${server.hostname}:${server.port}`)

  return server
}

createApiServer()

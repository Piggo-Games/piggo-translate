import { Translator } from "./Translator"
import { WordDefinition, WordToken } from "@piggo-translate/core"
import { decodeBase64PcmChunksToWavBlob } from "../utils/AudioUtils"

type OpenAiRealtimeServerEvent = {
  type?: string
  delta?: string
  text?: string
  error?: {
    message?: string
  }
  response?: {
    status?: string
    status_details?: {
      error?: {
        message?: string
      }
    }
    usage?: {
      input_tokens?: number
      output_tokens?: number
    }
    output?: {
      content?: {
        type?: string
        text?: string
      }[]
    }[]
  }
}

type TranslationStructuredOutput = {
  words: WordToken[]
}

type TranslationWordToken = {
  word: string
  literal: string
  punctuation: boolean
}

type DefinitionsStructuredOutput = {
  definitions: WordDefinition[]
}

export const OpenAiTranslator = (): Translator => {

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY")

  const model = "gpt-realtime-1.5"// "gpt-realtime-1.5"
  const timeoutMs = 5000
  const defaultAudioVoice = "sage" // marin sage
  const defaultAudioFormat = "pcm16"

  type QueuedRequest = {
    prompt: string
    instructions: string
    modalities: ("text" | "audio")[]
    audioVoice?: string
    maxOutputTokens?: number
    resolveText?: (value: string) => void
    resolveAudio?: (value: Blob) => void
    reject: (error: Error) => void
  }

  type ActiveRequest = QueuedRequest & {
    startedAt: number
    timeout: ReturnType<typeof setTimeout>
    streamedText: string
    streamedAudioChunks: string[]
    receivedDoneEvent: boolean
  }

  let ws: WebSocket | null = null
  let isWsOpen = false
  let connectPromise: Promise<WebSocket> | null = null
  let activeRequest: ActiveRequest | null = null
  const queuedRequests: QueuedRequest[] = []

  const toError = (error: unknown, fallbackMessage: string) => {
    return error instanceof Error ? error : new Error(fallbackMessage)
  }

  const resetConnection = () => {
    ws = null
    isWsOpen = false
    connectPromise = null
  }

  const settleActiveError = (error: unknown) => {
    if (!activeRequest) {
      return
    }

    const currentRequest = activeRequest
    activeRequest = null
    clearTimeout(currentRequest.timeout)
    currentRequest.reject(toError(error, "OpenAI request failed"))
    void processNextRequest()
  }

  const settleActiveSuccess = () => {
    if (!activeRequest) return

    const currentRequest = activeRequest

    activeRequest = null
    clearTimeout(currentRequest.timeout)

    if (currentRequest.resolveAudio) {
      const audioBlob = decodeBase64PcmChunksToWavBlob(currentRequest.streamedAudioChunks)

      if (!audioBlob.size) {
        currentRequest.reject(new Error("OpenAI realtime returned empty audio output"))
      } else {
        currentRequest.resolveAudio(audioBlob)
      }

      void processNextRequest()
      return
    }

    const doneText = currentRequest.streamedText.trim()

    if (!doneText) {
      currentRequest.reject(new Error("OpenAI realtime returned empty text output"))
      void processNextRequest()
      return
    }

    currentRequest.resolveText?.(doneText)
    void processNextRequest()
  }

  const parseRealtimeEvent = (rawData: unknown): OpenAiRealtimeServerEvent | null => {
    try {
      if (typeof rawData !== "string") {
        const messageText =
          rawData instanceof Uint8Array
            ? Buffer.from(rawData).toString("utf8")
            : String(rawData)

        return JSON.parse(messageText) as OpenAiRealtimeServerEvent
      }

      return JSON.parse(rawData) as OpenAiRealtimeServerEvent
    } catch {
      return null
    }
  }

  const onRealtimeMessage = (rawData: unknown) => {
    const parsedEvent = parseRealtimeEvent(rawData)

    if (!parsedEvent || !activeRequest) {
      return
    }

    if (parsedEvent.type === "error") {
      settleActiveError(
        new Error(parsedEvent.error?.message || "OpenAI realtime request failed")
      )
      return
    }

    if (
      parsedEvent.type === "response.output_text.delta" &&
      typeof parsedEvent.delta === "string"
    ) {
      activeRequest.streamedText += parsedEvent.delta
      return
    }

    if (
      parsedEvent.type === "response.output_text.done" &&
      typeof parsedEvent.text === "string" &&
      !activeRequest.streamedText.trim()
    ) {
      activeRequest.streamedText = parsedEvent.text
      return
    }

    if (
      parsedEvent.type === "response.audio.delta" &&
      typeof parsedEvent.delta === "string"
    ) {
      activeRequest.streamedAudioChunks.push(parsedEvent.delta)
      return
    }

    if (
      parsedEvent.type === "response.output_audio.delta" &&
      typeof parsedEvent.delta === "string"
    ) {
      activeRequest.streamedAudioChunks.push(parsedEvent.delta)
      return
    }

    if (parsedEvent.type !== "response.done") {
      return
    }

    activeRequest.receivedDoneEvent = true

    const failedStatus =
      parsedEvent.response?.status &&
      parsedEvent.response.status !== "completed"
    const isAudioRequest = activeRequest.modalities.includes("audio")
    const hasAudioOutput = activeRequest.streamedAudioChunks.length > 0
    const isAcceptableIncompleteAudioResponse =
      parsedEvent.response?.status === "incomplete" &&
      isAudioRequest &&
      hasAudioOutput

    if (failedStatus && !isAcceptableIncompleteAudioResponse) {
      settleActiveError(
        new Error(
          parsedEvent.response?.status_details?.error?.message ||
          `OpenAI response ended with status '${parsedEvent.response?.status}'`
        )
      )
      return
    }

    const doneText = getResponseTextFromDoneEvent(parsedEvent)
    if (!activeRequest.streamedText.trim() && doneText) {
      activeRequest.streamedText = doneText
    }

    const inputTokens = getInputTokenCountFromDoneEvent(parsedEvent)
    const outputTokens = getOutputTokenCountFromDoneEvent(parsedEvent)
    const responseDurationMs = performance.now() - activeRequest.startedAt
    console.log(
      `[openai] response ${responseDurationMs.toFixed(0)}ms (input: ${inputTokens ?? "?"}, output: ${outputTokens ?? "?"})`
    )

    settleActiveSuccess()
  }

  const ensureConnected = async (): Promise<WebSocket> => {
    const currentSocket = ws

    if (currentSocket && isWsOpen && currentSocket.readyState === WebSocket.OPEN) {
      return currentSocket
    }

    if (connectPromise) {
      return connectPromise
    }

    const apiKeyPreview =
      apiKey.length > 10 ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : "[redacted]"
    console.log(
      `[openai] connecting to realtime websocket (model ${model}, key ${apiKeyPreview})`
    )

    connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const nextSocket = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          // @ts-expect-error
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "OpenAI-Beta": "realtime=v1"
          }
        }
      )

      const onOpen = () => {
        isWsOpen = true
        ws = nextSocket
        console.log("[openai] realtime websocket opened")
        nextSocket.send(
          JSON.stringify({
            type: "session.update",
            session: {
              voice: defaultAudioVoice,
              output_audio_format: defaultAudioFormat
            }
          })
        )
        resolve(nextSocket)
      }

      const onErrorBeforeOpen = (event: unknown) => {
        console.error("[openai] websocket error before open", event)
        resetConnection()
        reject(new Error("OpenAI realtime websocket connection failed"))
      }

      nextSocket.addEventListener("open", onOpen, { once: true })
      nextSocket.addEventListener("error", onErrorBeforeOpen, { once: true })
      nextSocket.addEventListener("message", (event) => {
        onRealtimeMessage(event.data)
      })
      nextSocket.addEventListener("error", (event) => {
        console.error("[openai] websocket runtime error", event)
        settleActiveError(new Error("OpenAI realtime websocket error"))
      })
      nextSocket.addEventListener("close", (event) => {
        console.log(
          `[openai] websocket closed code=${event.code} reason='${event.reason}' clean=${event.wasClean}`
        )
        const closedBeforeCompletion =
          !!activeRequest && !activeRequest.receivedDoneEvent

        resetConnection()

        if (closedBeforeCompletion) {
          settleActiveError(
            new Error("OpenAI realtime websocket closed before completion")
          )
        }
      })
    })

    try {
      return await connectPromise
    } finally {
      connectPromise = null
    }
  }

  const sendActiveRequest = async () => {
    if (!activeRequest) return

    const socket = await ensureConnected()

    socket.send(
      JSON.stringify({
        type: "response.create",
        response: {
          conversation: "none",
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: activeRequest.prompt
                }
              ]
            }
          ],
          modalities: activeRequest.modalities,
          max_output_tokens: activeRequest.maxOutputTokens || 1024,
          instructions: activeRequest.instructions
        }
      })
    )
  }

  const processNextRequest = async () => {
    if (activeRequest || !queuedRequests.length) {
      return
    }

    const nextRequest = queuedRequests.shift()

    if (!nextRequest) return

    activeRequest = {
      ...nextRequest,
      startedAt: performance.now(),
      timeout: setTimeout(() => {
        settleActiveError(
          new Error(`OpenAI realtime request timed out after ${timeoutMs}ms`)
        )

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close()
        }
      }, timeoutMs),
      streamedText: "",
      streamedAudioChunks: [],
      receivedDoneEvent: false
    }

    try {
      await sendActiveRequest()
    } catch (error) {
      settleActiveError(error)
    }
  }

  const runOpenAiRealtimeRequest = async (prompt: string, instructions: string) => {
    return await new Promise<string>((resolve, reject) => {
      queuedRequests.push({
        prompt,
        instructions,
        modalities: ["text"],
        resolveText: resolve,
        maxOutputTokens: 1024,
        reject: (error) => reject(error)
      })

      void processNextRequest()
    })
  }

  const runOpenAiRealtimeAudioRequest = async (text: string, targetLanguage: string) => {
    return await new Promise<Blob>((resolve, reject) => {
      queuedRequests.push({
        prompt: buildAudioPrompt(text, targetLanguage),
        instructions: "You are a text-to-speech engine. Speak the provided text exactly, with natural pacing.",
        modalities: ["audio", "text"],
        audioVoice: defaultAudioVoice,
        resolveAudio: resolve,
        maxOutputTokens: 256,
        reject: (error) => reject(error)
      })

      void processNextRequest()
    })
  }

  return {
    translate: async (text, targetLanguage) => {
      const rawText = await runOpenAiRealtimeRequest(
        text,
        buildTranslationInstructions(targetLanguage)
      )

      return parseStructuredTranslation(rawText)
    },
    getDefinitions: async (word, targetLanguage, context) => {
      const rawText = await runOpenAiRealtimeRequest(
        word,
        buildDefinitionInstructions(targetLanguage, context.trim(), word.length)
      )
      // console.log(rawText)

      return parseStructuredDefinitions(rawText, word).definitions
    },
    getGrammar: async (text, targetLanguage) => {
      const trimmedText = text.trim()
      const trimmedTargetLanguage = targetLanguage.trim()

      if (!trimmedText) {
        throw new Error("Grammar input cannot be empty")
      }

      if (!trimmedTargetLanguage) {
        throw new Error("Grammar target language cannot be empty")
      }

      console.log(`Requesting grammar explanation for text: "${trimmedText}" in language: "${trimmedTargetLanguage}"`)

      const fmtText = `--------------------------- text below this line -----------------------------\n\n${trimmedText}`

      const rawText = await runOpenAiRealtimeRequest(
        fmtText,
        buildGrammarInstructions(trimmedTargetLanguage)
      )

      console.log(`Received grammar explanation: "${rawText}"`)
      return rawText
    },
    getAudio: async (text, targetLanguage) => {
      const trimmedText = text.trim()
      const trimmedTargetLanguage = targetLanguage.trim()

      if (!trimmedText) {
        throw new Error("Text-to-speech input cannot be empty")
      }

      if (!trimmedTargetLanguage) {
        throw new Error("Text-to-speech target language cannot be empty")
      }

      return await runOpenAiRealtimeAudioRequest(trimmedText, trimmedTargetLanguage)
    }
  }
}

const parseStructuredTranslation = (rawText: string) => {
  const trimmed = rawText.trim()
  const jsonCandidate = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  if (!jsonCandidate) {
    throw new Error("OpenAI returned an empty structured response")
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(jsonCandidate)
  } catch {
    console.error(jsonCandidate)
    throw new Error("OpenAI returned invalid structured JSON")
  }

  const literalPairs = normalizeTranslationLiteralPairs(parsed)

  if (!literalPairs.length) {
    throw new Error("OpenAI structured response missing translation literal pairs")
  }

  return {
    words: literalPairs
  } satisfies TranslationStructuredOutput
}

const normalizeTranslationLiteralPairs = (parsed: unknown): TranslationWordToken[] => {
  const arrayCandidate = Array.isArray(parsed)
    ? parsed
    : parsed &&
      typeof parsed === "object" &&
      "pairs" in parsed &&
      Array.isArray(parsed.pairs)
      ? parsed.pairs
      : []

  return arrayCandidate
    .filter((value): value is { word?: unknown, literal?: unknown, punctuation?: unknown } => !!value && typeof value === "object")
    .map((value) => ({
      word: typeof value.word === "string" ? value.word.trim() : "",
      literal: typeof value.literal === "string" ? value.literal.trim() : "",
      punctuation: value.punctuation === true
    }))
    .filter((value) => !!value.word && (!!value.literal || value.punctuation))
}

const getResponseTextFromDoneEvent = (event: OpenAiRealtimeServerEvent) => {
  return (
    event.response?.output
      ?.flatMap((item) => item.content || [])
      .filter((content) => typeof content.text === "string")
      .map((content) => content.text || "")
      .join("")
      .trim() || ""
  )
}

const getInputTokenCountFromDoneEvent = (event: OpenAiRealtimeServerEvent) => {
  const inputTokens = event.response?.usage?.input_tokens

  if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
    return inputTokens
  }

  return null
}

const getOutputTokenCountFromDoneEvent = (event: OpenAiRealtimeServerEvent) => {
  const outputTokens = event.response?.usage?.output_tokens

  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
    return outputTokens
  }

  return null
}

const buildTranslationInstructions = (targetLanguage: string) => {
  return (
    `You are a translation engine. Translate from the user text into ${targetLanguage}.\n` +
    "Preserve meaning, tone, and formatting where possible.\n" +
    "Only return a valid JSON array with this shape: [{\"word\":\"...\",\"literal\":\"...\", \"punctuation\":true|false}]\n" +
    "Each \"literal\" is a transliteration of the translated word.\n" +
    "For Chinese transliteration, use pinyin with tone marks.\n" +
    "For Chinese output, each word must be a complete Chinese word (can be multi-character).\n" +
    "Do not include empty strings, markdown, code fences, or explanations.\n" +
    "If the output cannot be produced, still return valid JSON with the expected shape."
  )
}

const buildDefinitionInstructions = (targetLanguage: string, sentence: string, wordLength: number) => {
  return (
    `You write concise explanations for words.\n` +
    `Write the explanation in english.\n` +
    "The goal is to help someone understand a new word in their non-native language.\n" +
    "describe the etymology/usage/grammar of the word.\n" +
    `The language of the word to define is ${targetLanguage}.\n` +
    `The surrounding context for the word is: "${sentence}"\n` +
    "Return only valid JSON with exactly this shape: {\"definition\":\"...\"}\n" +
    `Keep the definition under 20 words.\n` +
    (wordLength === 1 ? "If the word is a Chinese character, explain its component radicals.\n" : "") +
    "Do not include the word itself.\n" +
    "Do not repeat the provided context.\n" +
    "Do not include markdown or code fences."
  )
}

const buildGrammarInstructions = (targetLanguage: string) => {
  return (
    "You are a grammar assistant\n" + //(IN ENGLISH!!) the grammar of the provided text.\n" +
    "Always respond in English!!\n" +
    `The text's language is ${targetLanguage}.\n` +
    "Explain only the most important points that a non-native speaker would need to understand the grammar.\n" +
    "Keep your explanation concise (max 20 words) and simple (avoid complex terminology).\n" +
    "DO NOT RESPOND/REPLY TO THE TEXT ITSELF. YOU ARE NOT A CHATBOT!!\n" +
    "Do not over-explain obvious things.\n" +
    "Do not use markdown, code fences, or bullet points.\n" +
    "Do not include the original text in your explanation.\n"
  )
}

const buildAudioPrompt = (text: string, targetLanguage: string) => {
  return (
    `Speak the exact text below in ${targetLanguage}. Do not add or remove words.\n` +
    "-------------------------- text below this line -----------------------------\n\n" +
    text
  )
}

const parseStructuredDefinitions = (rawText: string, requestedWord: string) => {
  const trimmed = rawText.trim()
  const jsonCandidate = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  if (!jsonCandidate) {
    throw new Error("OpenAI returned an empty structured definitions response")
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(jsonCandidate)
  } catch {
    console.error(jsonCandidate)
    throw new Error("OpenAI returned invalid structured definitions JSON")
  }

  const parsedDefinitionText =
    parsed &&
      typeof parsed === "object" &&
      "definition" in parsed &&
      typeof parsed.definition === "string"
      ? parsed.definition.trim()
      : ""

  const parsedDefinitions =
    parsed &&
      typeof parsed === "object" &&
      "definitions" in parsed &&
      Array.isArray(parsed.definitions)
      ? parsed.definitions
      : []

  const normalizedDefinitions = parsedDefinitions
    .filter((value): value is { word?: unknown, definition?: unknown } => !!value && typeof value === "object")
    .map((value) => ({
      word: typeof value.word === "string" ? value.word.trim() : "",
      definition: typeof value.definition === "string" ? value.definition.trim() : ""
    }))
    .filter((value) => !!value.word && !!value.definition)

  if (!normalizedDefinitions.length && !parsedDefinitionText) {
    throw new Error("OpenAI structured definitions response missing 'definitions'")
  }

  const definitionByWord = new Map(normalizedDefinitions.map((item) => [item.word, item.definition]))
  const fallbackDefinition = parsedDefinitionText || definitionByWord.get(requestedWord) || ""
  const definitions = [{
    word: requestedWord,
    definition: fallbackDefinition
  }].filter((item) => !!item.definition)

  return { definitions }
}

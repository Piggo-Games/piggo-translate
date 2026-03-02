import {
  DefinitionPane, InputPane, OutputPane, TargetLanguageDropdown, Transliteration,
  normalizeDefinition, Cache, AudioCache, Client, RequestSnapshot, isLocal, isMobile,
  readTargetLanguage, writeTargetLanguage
} from "@piggo-translate/web"
import { Languages, Model, WordDefinition, WordToken } from "@piggo-translate/core"
import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

const isSpaceSeparatedLanguage = (language: string) =>
  !language.toLowerCase().includes("chinese") &&
  !language.toLowerCase().includes("japanese")

const isChineseLanguage = (language: string) => language.toLowerCase().includes("chinese")

const noSpaceBeforePunctuationPattern = /^[.,!?;:%)\]\}»”’、。，！？；：]$/
const noSpaceAfterPunctuationPattern = /^[(\[{«“‘]$/
const audioPlaybackGain = 3

const joinOutputTokens = (
  tokens: WordToken[],
  targetLanguage: string,
  tokenKey: "word" | "literal",
  options?: {
    forceSpaceSeparated?: boolean
  }
) => {
  const useSpaces = options?.forceSpaceSeparated || isSpaceSeparatedLanguage(targetLanguage)

  return tokens.reduce((result, token, tokenIndex) => {
    const tokenValue = token[tokenKey]

    if (!tokenValue) {
      return result
    }

    if (!result) {
      return tokenValue
    }

    if (!useSpaces) {
      return `${result}${tokenValue}`
    }

    const previousToken = tokens[tokenIndex - 1]
    const previousWord = previousToken?.word || ""
    const hasNoSpaceBefore = token.punctuation && noSpaceBeforePunctuationPattern.test(token.word)
    const hasNoSpaceAfterPrevious = !!previousToken?.punctuation && noSpaceAfterPunctuationPattern.test(previousWord)
    const joiner = hasNoSpaceBefore || hasNoSpaceAfterPrevious ? "" : " "
    return `${result}${joiner}${tokenValue}`
  }, "")
}

const isEditableElement = (element: Element | null) => {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled
  }

  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !element.disabled
  }

  return element.isContentEditable
}

const getAutoDefinitionWords = (tokens: WordToken[]) => {
  const selectableWords = tokens
    .filter(({ punctuation }) => !punctuation)
    .map(({ word }) => word)
    .filter((word) => !!normalizeDefinition(word))

  return selectableWords.length === 1 ? selectableWords : []
}

const getDefinitionSelectionWords = (selectedWords: string[], targetLanguage: string) => {
  const normalizedSelectedWords = selectedWords
    .map((word) => normalizeDefinition(word))
    .filter(Boolean)

  if (!isChineseLanguage(targetLanguage)) {
    return Array.from(new Set(normalizedSelectedWords))
  }

  const expandedWords = normalizedSelectedWords.flatMap((word) => {
    const characters = Array.from(word)

    if (characters.length < 2) {
      return [word]
    }

    return [word, ...characters]
  })

  return Array.from(new Set(expandedWords))
}

const App = () => {
  const [inputText, setInputText] = useState("")
  const [outputWords, setOutputWords] = useState<WordToken[]>([])
  const [isTransliterationVisible, setIsTransliterationVisible] = useState(true)
  const [errorText, setErrorText] = useState("")
  const [isTranslating, setIsTranslating] = useState(false)
  const [isSocketOpen, setIsSocketOpen] = useState(false)
  const [latestRequestSnapshot, setLatestRequestSnapshot] = useState<RequestSnapshot>({
    id: "",
    normalizedInputText: ""
  })
  const [debouncedRequest, setDebouncedRequest] = useState<{
    text: string
    targetLanguage: string
    model: Model
  } | null>(null)
  const [targetLanguage, setTargetLanguage] = useState(Languages[0].value)
  const [isTargetLanguageLoaded, setIsTargetLanguageLoaded] = useState(false)
  const [selectedModel, setSelectedModel] = useState<Model>("openai")
  const [selectedOutputWords, setSelectedOutputWords] = useState<string[]>([])
  const [wordDefinitions, setWordDefinitions] = useState<WordDefinition[]>([])
  const [isDefinitionLoading, setIsDefinitionLoading] = useState(false)
  const [isAudioLoading, setIsAudioLoading] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [isConnectionDotDelayComplete, setIsConnectionDotDelayComplete] = useState(false)
  const clientRef = useRef<Client | null>(null)
  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingInputSelectionRef = useRef<{ start: number, end: number } | null>(null)
  const selectedDefinitionWordsRef = useRef<string[]>([])
  const definitionContextRef = useRef("")
  const targetLanguageRef = useRef(targetLanguage)
  const selectedModelRef = useRef(selectedModel)
  const CacheRef = useRef(Cache())
  const audioCacheRef = useRef(AudioCache())
  const headerSectionRef = useRef<HTMLElement | null>(null)
  const paneStackRef = useRef<HTMLElement | null>(null)
  const audioSourceUrlRef = useRef("")
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioGainNodeRef = useRef<GainNode | null>(null)
  const activeAudioSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const pendingAudioRequestTextRef = useRef("")

  const clearAudioPlayback = () => {
    setIsAudioPlaying(false)

    if (activeAudioSourceNodeRef.current) {
      activeAudioSourceNodeRef.current.disconnect()
      activeAudioSourceNodeRef.current = null
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
      activeAudioRef.current.src = ""
      activeAudioRef.current = null
    }

    if (!audioSourceUrlRef.current) {
      return
    }

    URL.revokeObjectURL(audioSourceUrlRef.current)
    audioSourceUrlRef.current = ""
  }

  const createAudioUrlFromBase64 = (audioBase64: string, mimeType: string) => {
    const binaryAudio = atob(audioBase64)
    const audioBytes = new Uint8Array(binaryAudio.length)

    for (let index = 0; index < binaryAudio.length; index += 1) {
      audioBytes[index] = binaryAudio.charCodeAt(index)
    }

    const audioBlob = new Blob([audioBytes], { type: mimeType || "audio/pcm" })
    return URL.createObjectURL(audioBlob)
  }

  const connectAudioGainNode = (audio: HTMLAudioElement) => {
    if (typeof window === "undefined" || !window.AudioContext) {
      return null
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext()
    }

    if (!audioGainNodeRef.current) {
      audioGainNodeRef.current = audioContextRef.current.createGain()
      audioGainNodeRef.current.connect(audioContextRef.current.destination)
    }

    audioGainNodeRef.current.gain.value = audioPlaybackGain
    const sourceNode = audioContextRef.current.createMediaElementSource(audio)
    sourceNode.connect(audioGainNodeRef.current)
    activeAudioSourceNodeRef.current = sourceNode

    return sourceNode
  }

  const playAudio = (audioBase64: string, mimeType: string) => {
    const nextAudioSourceUrl = createAudioUrlFromBase64(audioBase64, mimeType)
    clearAudioPlayback()
    audioSourceUrlRef.current = nextAudioSourceUrl

    const audio = new Audio(nextAudioSourceUrl)
    const sourceNode = connectAudioGainNode(audio)
    activeAudioRef.current = audio
    setIsAudioPlaying(true)
    audio.onended = () => {
      setIsAudioPlaying(false)

      if (sourceNode && activeAudioSourceNodeRef.current === sourceNode) {
        sourceNode.disconnect()
        activeAudioSourceNodeRef.current = null
      }

      if (activeAudioRef.current === audio) {
        activeAudioRef.current = null
      }

      if (audioSourceUrlRef.current === nextAudioSourceUrl) {
        URL.revokeObjectURL(nextAudioSourceUrl)
        audioSourceUrlRef.current = ""
      }
    }
    audio.onerror = () => {
      if (sourceNode && activeAudioSourceNodeRef.current === sourceNode) {
        sourceNode.disconnect()
        activeAudioSourceNodeRef.current = null
      }

      setErrorText("Unable to play audio")
      clearAudioPlayback()
    }

    void (async () => {
      try {
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume()
        }

        await audio.play()
      } catch {
        setErrorText("Unable to play audio")
        clearAudioPlayback()
      }
    })()
    setErrorText("")
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsConnectionDotDelayComplete(true)
    }, 1000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearAudioPlayback()

      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    const headerSection = headerSectionRef.current
    const paneStack = paneStackRef.current

    if (!headerSection || !paneStack) return
    if (isMobile()) return

    const updatePaneStackMarginTop = () => {
      const minimumGapFromHeader = 16
      const headerBottom = headerSection.getBoundingClientRect().bottom
      const paneStackHeight = paneStack.getBoundingClientRect().height
      const centeredTop = Math.max((window.innerHeight - paneStackHeight) / 2, 0)
      const targetTop = Math.max(centeredTop, headerBottom + minimumGapFromHeader)
      const marginTop = Math.max(targetTop - headerBottom - 40, 0)

      paneStack.style.marginTop = `${marginTop}px`
    }

    const resizeObserver = new ResizeObserver(() => {
      updatePaneStackMarginTop()
    })

    resizeObserver.observe(paneStack)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  const normalizedInputText = normalizeText(inputText)
  const hasInputText = !!normalizedInputText
  const hasOutputWords = outputWords.length > 0
  const isSpinnerVisible =
    isTranslating &&
    !!latestRequestSnapshot.id &&
    normalizedInputText === latestRequestSnapshot.normalizedInputText

  useEffect(() => {
    const client = Client({
      onSocketOpenChange: setIsSocketOpen,
      onErrorTextChange: setErrorText,
      onTranslatingChange: setIsTranslating,
      onDefinitionLoadingChange: setIsDefinitionLoading,
      onLatestRequestChange: setLatestRequestSnapshot,
      onTranslateSuccess: (words) => {
        const selection = window.getSelection()
        const activeElement = document.activeElement
        const shouldClearSelection = !isEditableElement(activeElement)
        const autoDefinitionWords = getAutoDefinitionWords(words)

        if (selection && shouldClearSelection) {
          selection.removeAllRanges()
        }

        setOutputWords(words)
        clearAudioPlayback()
        setIsAudioLoading(false)
        definitionContextRef.current = joinOutputTokens(words, targetLanguageRef.current, "word")
        setSelectedOutputWords(autoDefinitionWords)
        setWordDefinitions([])
        setIsDefinitionLoading(false)
        client.clearDefinitionRequestState()
      },
      onTranslateError: (error) => {
        setIsAudioLoading(false)
        setErrorText(error)
      },
      onDefinitionsSuccess: (definitions) => {
        CacheRef.current.writeDefinitionsToCache(definitions)
        const selectedWords = selectedDefinitionWordsRef.current
        setWordDefinitions(CacheRef.current.getCachedDefinitions(selectedWords))
      },
      onDefinitionsError: () => {
        setWordDefinitions([])
        setIsDefinitionLoading(false)
      },
      onAudioLoadingChange: setIsAudioLoading,
      onAudioSuccess: (audioBase64, mimeType) => {
        if (pendingAudioRequestTextRef.current) {
          audioCacheRef.current.set({
            text: pendingAudioRequestTextRef.current,
            audioBase64,
            mimeType
          })
        }

        playAudio(audioBase64, mimeType)
        pendingAudioRequestTextRef.current = ""
      },
      onAudioError: (errorText) => {
        setIsAudioLoading(false)
        setErrorText(errorText)
        pendingAudioRequestTextRef.current = ""
      }
    })

    clientRef.current = client
    client.connect()

    return () => {
      client.dispose()
      clientRef.current = null
    }
  }, [])

  useEffect(() => {
    targetLanguageRef.current = targetLanguage
  }, [targetLanguage])

  useEffect(() => {
    selectedModelRef.current = selectedModel
  }, [selectedModel])

  useEffect(() => {
    let isDisposed = false

    void (async () => {
      const persistedTargetLanguage = await readTargetLanguage()

      if (isDisposed) {
        return
      }

      if (persistedTargetLanguage && Languages.some((language) => language.value === persistedTargetLanguage)) {
        setTargetLanguage(persistedTargetLanguage)
      }

      setIsTargetLanguageLoaded(true)
    })()

    return () => {
      isDisposed = true
    }
  }, [])

  useEffect(() => {
    if (!isTargetLanguageLoaded) {
      return
    }

    void writeTargetLanguage(targetLanguage)
  }, [targetLanguage, isTargetLanguageLoaded])

  useEffect(() => {
    const textarea = inputTextareaRef.current
    const pendingSelection = pendingInputSelectionRef.current

    if (!textarea || !pendingSelection) {
      return
    }

    pendingInputSelectionRef.current = null
    textarea.setSelectionRange(pendingSelection.start, pendingSelection.end)
  }, [inputText])

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const textarea = inputTextareaRef.current
      if (!textarea) return

      textarea.focus()

      if (
        event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey
      ) return
      if (event.key === "Tab") {
        event.preventDefault()
        return
      }

      const activeElement = document.activeElement

      if (activeElement === textarea) return

      if (isEditableElement(activeElement)) return

      event.preventDefault()

      const selectionStart = textarea.selectionStart ?? textarea.value.length
      const selectionEnd = textarea.selectionEnd ?? textarea.value.length
      const isBackspaceKey = event.key === "Backspace"
      const deleteStart =
        isBackspaceKey && selectionStart === selectionEnd
          ? Math.max(0, selectionStart - 1)
          : selectionStart
      const deleteEnd = selectionEnd
      const insertedText = isBackspaceKey ? "" : event.key
      const nextValue =
        `${textarea.value.slice(0, deleteStart)}${insertedText}${textarea.value.slice(deleteEnd)}`
      const nextCursorPosition = deleteStart + insertedText.length

      pendingInputSelectionRef.current = {
        start: nextCursorPosition,
        end: nextCursorPosition
      }
      setInputText(nextValue)
    }

    window.addEventListener("keydown", handleWindowKeyDown)

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown)
    }
  }, [])

  // if input changes
  useEffect(() => {
    const trimmedText = inputText.trim()
    clientRef.current?.setCurrentNormalizedInputText(normalizedInputText)

    if (!trimmedText) {
      setOutputWords([])
      setSelectedOutputWords([])
      setWordDefinitions([])
      setIsDefinitionLoading(false)
      setIsAudioLoading(false)
      clearAudioPlayback()
      setErrorText("")
      setDebouncedRequest(null)
      clientRef.current?.clearAllRequestState()
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedRequest({
        text: trimmedText,
        targetLanguage,
        model: selectedModel
      })
    }, isMobile() ? 1000 : 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [inputText, normalizedInputText])

  // if language changes
  useEffect(() => {
    setOutputWords([])
    setSelectedOutputWords([])
    setWordDefinitions([])
    setIsDefinitionLoading(false)
    setIsAudioLoading(false)
    clearAudioPlayback()
    setErrorText("")

    const trimmedText = inputText.trim()

    if (!trimmedText) {
      setDebouncedRequest(null)
      clientRef.current?.clearAllRequestState()
      return
    }

    setDebouncedRequest({
      text: trimmedText,
      targetLanguage,
      model: selectedModel
    })
  }, [targetLanguage])

  useEffect(() => {
    if (!debouncedRequest || !isSocketOpen) {
      return
    }

    clientRef.current?.sendTranslateRequest(debouncedRequest)
  }, [debouncedRequest, isSocketOpen])

  useEffect(() => {
    const definitionSelectionWords = getDefinitionSelectionWords(selectedOutputWords, targetLanguage)
    selectedDefinitionWordsRef.current = definitionSelectionWords

    if (!definitionSelectionWords.length) {
      setWordDefinitions([])
      setIsDefinitionLoading(false)
      clientRef.current?.clearDefinitionRequestState()
      return
    }

    const cachedDefinitions = CacheRef.current.getCachedDefinitions(definitionSelectionWords)
    setWordDefinitions(cachedDefinitions)

    const missingWords = CacheRef.current.getMissingDefinitionWords(definitionSelectionWords)
    const definitionContext = joinOutputTokens(outputWords, targetLanguage, "word")

    if (!missingWords.length) {
      setIsDefinitionLoading(false)
      clientRef.current?.clearDefinitionRequestState()
      return
    }

    if (!isSocketOpen) return

    definitionContextRef.current = definitionContext
    missingWords.forEach((word) => {
      clientRef.current?.sendDefinitionsRequest({
        word,
        context: definitionContext,
        targetLanguage,
        model: selectedModel
      })
    })
  }, [outputWords, selectedOutputWords, isSocketOpen, selectedModel, targetLanguage])

  const definitionByWord = new Map(
    wordDefinitions.map((entry) => [normalizeDefinition(entry.word), entry.definition])
  )
  const definitionSelectionWords = getDefinitionSelectionWords(selectedOutputWords, targetLanguage)
  const transliterationByWord = new Map<string, string>()

  outputWords
    .filter(({ punctuation }) => !punctuation)
    .forEach(({ word, literal }) => {
      const normalizedWord = normalizeDefinition(word)
      const transliterationKey = normalizedWord || word

      if (transliterationByWord.has(transliterationKey)) {
        return
      }

      if (literal) {
        transliterationByWord.set(transliterationKey, literal)
      }
    })

  const selectedLanguageOption = Languages.find((language) => language.value === targetLanguage)

  return (
    <main>
      <section ref={headerSectionRef} style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginBottom: "1rem",
        flexDirection: "column",
        left: "50%"
      }}>
        <img src="favicon.svg" alt="" aria-hidden="true" className="title-icon fade-in" draggable={false} />
        <p className="header-title">Piggo Translate</p>
      </section>

      {/* <TranslateToolbar
        errorText={errorText}
        languageOptions={languageOptions}
        targetLanguage={targetLanguage}
        onLanguageSelect={(language) => {
          setTargetLanguage(language)
        }}
      /> */}

      <section ref={paneStackRef} className="pane-stack" aria-label="Translator workspace">
        {!isSocketOpen && isConnectionDotDelayComplete ? (
          <span className="pane-stack-connection-dot fade-in" aria-hidden="true" />
        ) : null}

        <TargetLanguageDropdown
          options={Languages}
          targetLanguage={targetLanguage}
          onSelect={setTargetLanguage}
        />

        <InputPane
          id="input-pane-title"
          title="Input"
          showHeader={false}
          placeholder=""
          ariaLabel="Text to translate"
          value={inputText}
          maxLength={360}
          autoFocus
          textareaRef={inputTextareaRef}
          onChange={setInputText}
          afterTextarea={hasInputText && isSpinnerVisible ? (
            <span className="spinner input-pane-spinner" aria-hidden="true" />
          ) : null}
          className="fade-in"
        />

        {hasOutputWords ? (
          <OutputPane
            id="output-pane-title"
            title="Translated Output"
            showHeader={false}
            ariaLabel="Translated text"
            value={joinOutputTokens(outputWords, targetLanguage, "word")}
            selectionTokens={outputWords.map((token) => ({
              value: token.word,
              selectionWord: token.word,
              selectable: !token.punctuation
            }))}
            selectionWordJoiner={isSpaceSeparatedLanguage(targetLanguage) ? " " : ""}
            animateOnMount
            footer={selectedLanguageOption?.transliterate ? (
                <Transliteration
                  value={joinOutputTokens(outputWords, targetLanguage, "literal", { forceSpaceSeparated: true })}
                  isVisible={isTransliterationVisible}
                  onToggle={() => setIsTransliterationVisible((value) => !value)}
                />
            ) : null}
            enableCopyButton
            copyValue={joinOutputTokens(outputWords, targetLanguage, "word")}
            enableAudioButton={!isAudioPlaying}
            isAudioLoading={isAudioLoading}
            onAudioClick={() => {
              const outputText = joinOutputTokens(outputWords, targetLanguage, "word")

              if (!outputText.trim()) {
                return
              }

              const cachedAudio = audioCacheRef.current.get(outputText)

              if (cachedAudio) {
                playAudio(cachedAudio.audioBase64, cachedAudio.mimeType)
                return
              }

              pendingAudioRequestTextRef.current = outputText
              clientRef.current?.sendAudioRequest({
                text: outputText,
                targetLanguage,
                model: selectedModelRef.current
              })
            }}
            className="fade-in"
            onSelectionChange={(selectionWords) => {
              setSelectedOutputWords(selectionWords)
            }}
          />
        ) : null}

        {definitionSelectionWords.map((word, index) => {
          const normalizedWord = normalizeDefinition(word)
          const definition = definitionByWord.get(normalizedWord) || ""
          const transliterationKey = normalizedWord || word
          const transliteration = transliterationByWord.get(transliterationKey) || ""
          const shouldShowTransliterationPrefix = !!selectedLanguageOption?.transliterate && !!transliteration
          const definitionPrefix = shouldShowTransliterationPrefix
            ? `${word} (${transliteration})`
            : word
          const paneValue = definition ? `${definitionPrefix} — ${definition}` : word

          return (
            <DefinitionPane
              key={`definition-pane-${index}`}
              id={`definition-pane-${index}-title`}
              title=""
              showHeader={false}
              animateOnMount
              className="fade-in"
              ariaLabel={`Definition for ${word}`}
              value={paneValue}
            />
          )
        })}
      </section>

      {isLocal() && !isMobile() && (
        <span className="app-version" aria-label="App version">
          v0.3.6
        </span>
      )}
    </main>
  )
}

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Missing root div with id 'root'")
}

createRoot(rootElement).render(<App />)

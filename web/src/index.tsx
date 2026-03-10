import {
  DefinitionPane, GrammarPane, InputPane, OutputPane, TargetLanguageDropdown,
  Transliteration, normalizeText, normalizeDefinition, Cache, AudioCache, GrammarCache,
  Client, RequestSnapshot, isLocal, isMobile, readTargetLanguage, writeTargetLanguage
} from "@piggo-translate/web"
import {
  Hsk1Characters, Languages, WordDefinition, WordToken, splitPinyin, isLanguageCode,
  isLanguageValueLower, languageCodeToValue, languageValueToCode, LanguageCode, LanguageValueLower
} from "@piggo-translate/core"
import { startTransition, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

const isSpaceSeparatedLanguage = (language: string) => ![
  "chinese (simplified)", "japanese"
].includes(language.toLowerCase())

const isChineseLanguage = (language: string) => language.toLowerCase().includes("chinese")

const noSpaceBeforePunctuationPattern = /^[.,!?;:%)\]\}»”’、。，！？；：]$/
const noSpaceAfterPunctuationPattern = /^[(\[{«“‘]$/
const audioPlaybackGain = 3

const trimWrappingQuotes = (value: string) => {
  const trimmedValue = value.trim()
  const startsWithSingleQuote = trimmedValue.startsWith("'") && trimmedValue.endsWith("'")
  const startsWithDoubleQuote = trimmedValue.startsWith("\"") && trimmedValue.endsWith("\"")

  if (trimmedValue.length < 2 || (!startsWithSingleQuote && !startsWithDoubleQuote)) {
    return trimmedValue
  }

  return trimmedValue.slice(1, -1).trim()
}

const getUrlParamValue = (searchParams: URLSearchParams, key: string) => {
  const rawValue = searchParams.get(key)
  if (!rawValue) {
    return ""
  }

  return trimWrappingQuotes(rawValue)
}

const getLanguageFromParam = (rawLanguageValue: string) => {
  if (!rawLanguageValue) {
    return ""
  }

  const normalizedValue = rawLanguageValue.trim().toLowerCase()
  const languageByCode = isLanguageCode(normalizedValue)
    ? languageCodeToValue(normalizedValue as LanguageCode)
    : undefined

  if (languageByCode) {
    return languageByCode
  }

  const matchedLanguage = Languages.find((language) => {
    const valueMatch = language.value.toLowerCase() === normalizedValue
    const labelMatch = language.label.toLowerCase() === normalizedValue
    return valueMatch || labelMatch
  })

  return matchedLanguage?.value || ""
}

const getLanguageParamValue = (language: string) => {
  const normalizedLanguage = language.trim().toLowerCase()
  const languageCode = isLanguageValueLower(normalizedLanguage)
    ? languageValueToCode(normalizedLanguage as LanguageValueLower)
    : undefined

  if (languageCode) {
    return languageCode
  }

  return language
}

const getUrlPrefillState = () => {
  if (typeof window === "undefined") {
    return { text: "", targetLanguage: "" }
  }

  const searchParams = new URLSearchParams(window.location.search)
  const text = getUrlParamValue(searchParams, "t")
  const requestedLanguage = getUrlParamValue(searchParams, "l")
  const targetLanguage = getLanguageFromParam(requestedLanguage)

  return { text, targetLanguage }
}

const getFormattedLiteral = (literal: string, targetLanguage: string) => {
  if (!isChineseLanguage(targetLanguage)) return literal

  const splitLiteral = splitPinyin(literal)
  return splitLiteral.length > 1 ? splitLiteral.join(" ") : literal
}

const joinOutputTokens = (
  tokens: WordToken[], targetLanguage: string, tokenKey: "word" | "literal", options?: {
    forceSpaceSeparated?: boolean
  }
) => {
  const useSpaces = options?.forceSpaceSeparated || isSpaceSeparatedLanguage(targetLanguage)

  return tokens.reduce((result, token, tokenIndex) => {
    const rawTokenValue = token[tokenKey]
    const tokenValue = rawTokenValue

    if (!tokenValue) return result

    if (!result) return tokenValue

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

const getCharacterTransliteration = (
  character: string,
  parentWord: string,
  transliterations: Map<string, string>
) => {
  if (Array.from(character).length !== 1) {
    return ""
  }

  const transliteration = transliterations.get(parentWord)
  if (!transliteration) {
    return ""
  }

  const parentCharacters = Array.from(parentWord)
  const splitLiteral = splitPinyin(transliteration)

  if (parentCharacters.length <= 1 || splitLiteral.length !== parentCharacters.length) {
    return ""
  }

  const firstMatchingCharacterIndex = parentCharacters.indexOf(character)

  if (
    firstMatchingCharacterIndex === -1 ||
    parentCharacters.lastIndexOf(character) !== firstMatchingCharacterIndex
  ) {
    return ""
  }

  const transliterationIndex = firstMatchingCharacterIndex
  return splitLiteral[transliterationIndex]
}

const getTransliterationParentWord = (character: string, definitionSelectionWords: string[]) => {
  return definitionSelectionWords.find((word) => {
    const wordCharacters = Array.from(word)
    return wordCharacters.length > 1 && wordCharacters.includes(character)
  }) || ""
}

const getNonPunctuationWordCount = (tokens: WordToken[]) => {
  return tokens.reduce((count, token) => {
    const normalizedWord = normalizeDefinition(token.word)

    if (token.punctuation || !normalizedWord) {
      return count
    }

    return count + 1
  }, 0)
}

const App = () => {
  const initialUrlPrefillRef = useRef(getUrlPrefillState())
  const [inputText, setInputText] = useState(() => initialUrlPrefillRef.current.text)
  const [isPiggoLingoVisible, setIsPiggoLingoVisible] = useState(false)
  const [titleIconSpinTick, setTitleIconSpinTick] = useState(0)
  const [isTitleIconSpinning, setIsTitleIconSpinning] = useState(false)
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
  } | null>(null)
  const [targetLanguage, setTargetLanguage] = useState(() => {
    return initialUrlPrefillRef.current.targetLanguage || Languages[0].value
  })
  const [isTargetLanguageLoaded, setIsTargetLanguageLoaded] = useState(false)
  const [selectedOutputWords, setSelectedOutputWords] = useState<string[]>([])
  const [wordDefinitions, setWordDefinitions] = useState<WordDefinition[]>([])
  const [isDefinitionLoading, setIsDefinitionLoading] = useState(false)
  const [grammarExplanation, setGrammarExplanation] = useState("")
  const [isGrammarLoading, setIsGrammarLoading] = useState(false)
  const [isAudioLoading, setIsAudioLoading] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [isConnectionDotDelayComplete, setIsConnectionDotDelayComplete] = useState(false)
  const clientRef = useRef<Client | null>(null)
  const inputTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingInputSelectionRef = useRef<{ start: number, end: number } | null>(null)
  const selectedDefinitionWordsRef = useRef<string[]>([])
  const definitionContextRef = useRef("")
  const targetLanguageRef = useRef(targetLanguage)
  const CacheRef = useRef(Cache())
  const audioCacheRef = useRef(AudioCache())
  const grammarCacheRef = useRef(GrammarCache())
  const headerSectionRef = useRef<HTMLElement | null>(null)
  const paneStackRef = useRef<HTMLElement | null>(null)
  const audioSourceUrlRef = useRef("")
  const activeAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioGainNodeRef = useRef<GainNode | null>(null)
  const activeAudioSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const pendingAudioRequestTextRef = useRef("")
  const pendingGrammarRequestTextRef = useRef("")

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

    const audioBlob = new Blob([audioBytes], { type: "audio/wav" })
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
        audio.preload = "auto"
        audio.load()

        await new Promise<void>((resolve, reject) => {
          let timeoutId = 0
          let isSettled = false

          const clear = () => {
            window.clearTimeout(timeoutId)
            audio.removeEventListener("canplaythrough", onReady)
            audio.removeEventListener("error", onError)
          }

          const settle = (callback: () => void) => {
            if (isSettled) {
              return
            }

            isSettled = true
            clear()
            callback()
          }

          const onReady = () => {
            settle(() => resolve())
          }

          const onError = () => {
            settle(() => reject(new Error("Unable to decode audio")))
          }

          audio.addEventListener("canplaythrough", onReady, { once: true })
          audio.addEventListener("error", onError, { once: true })
          timeoutId = window.setTimeout(() => {
            settle(() => resolve())
          }, 1000)
        })

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

    const resizeObserver = new ResizeObserver(updatePaneStackMarginTop)

    resizeObserver.observe(paneStack)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  const normalizedInputText = normalizeText(inputText)
  const hasInputText = !!normalizedInputText
  const hasOutputWords = outputWords.length > 0
  const hasMultipleOutputWords = getNonPunctuationWordCount(outputWords) > 1
  const outputText = joinOutputTokens(outputWords, targetLanguage, "word")
  const hasTargetText = !!outputText.trim()
  const outputLiteralText = joinOutputTokens(outputWords, targetLanguage, "literal", {
    forceSpaceSeparated: true
  })
  const definitionSelectionWords = useMemo(
    () => getDefinitionSelectionWords(selectedOutputWords, targetLanguage),
    [selectedOutputWords, targetLanguage]
  )
  const shouldShowGrammarPane =
    hasTargetText &&
    hasMultipleOutputWords &&
    definitionSelectionWords.length === 0
  const selectedLanguageOption = Languages.find((language) => language.value === targetLanguage)
  const isSpinnerVisible =
    isTranslating &&
    !!latestRequestSnapshot.id &&
    normalizedInputText === latestRequestSnapshot.normalizedInputText

  const resetTranslationState = (clearOutputWords: boolean) => {
    if (clearOutputWords) {
      setOutputWords([])
      setSelectedOutputWords([])
    }

    setWordDefinitions([])
    setIsDefinitionLoading(false)
    setGrammarExplanation("")
    setIsGrammarLoading(false)
    pendingGrammarRequestTextRef.current = ""
    setIsAudioLoading(false)
    clearAudioPlayback()
    setErrorText("")
  }

  const clearAllRequestState = (clearOutputWords: boolean) => {
    resetTranslationState(clearOutputWords)
    setDebouncedRequest(null)
    clientRef.current?.clearAllRequestState()
  }

  const setDebouncedTranslateRequest = (text: string) => {
    setDebouncedRequest({
      text,
      targetLanguage
    })
  }

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
        setGrammarExplanation("")
        setIsGrammarLoading(false)
        client.clearDefinitionRequestState()
        client.clearGrammarRequestState()
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
      onGrammarLoadingChange: setIsGrammarLoading,
      onGrammarSuccess: (grammar) => {
        if (pendingGrammarRequestTextRef.current) {
          grammarCacheRef.current.set({
            text: pendingGrammarRequestTextRef.current,
            grammar
          })
        }

        pendingGrammarRequestTextRef.current = ""
        setGrammarExplanation(grammar.trim())
      },
      onGrammarError: () => {
        pendingGrammarRequestTextRef.current = ""
        setGrammarExplanation("")
        setIsGrammarLoading(false)
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
    let isDisposed = false
    const deepLinkedLanguage = initialUrlPrefillRef.current.targetLanguage

    void (async () => {
      const persistedTargetLanguage = await readTargetLanguage()

      if (isDisposed) {
        return
      }

      if (deepLinkedLanguage) {
        setTargetLanguage(deepLinkedLanguage)
      } else if (
        persistedTargetLanguage &&
        Languages.some((language) => language.value === persistedTargetLanguage)
      ) {
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
    if (typeof window === "undefined" || !isTargetLanguageLoaded) {
      return
    }

    const currentUrl = new URL(window.location.href)
    const nextSearchParams = new URLSearchParams(currentUrl.search)
    const trimmedInputText = inputText.trim()
    const languageParamValue = getLanguageParamValue(targetLanguage)

    if (trimmedInputText) {
      nextSearchParams.set("t", trimmedInputText)
    } else {
      nextSearchParams.delete("t")
    }

    if (languageParamValue) {
      nextSearchParams.set("l", languageParamValue)
    } else {
      nextSearchParams.delete("l")
    }

    const nextSearch = nextSearchParams.toString()
    const currentSearch = currentUrl.search.startsWith("?")
      ? currentUrl.search.slice(1)
      : currentUrl.search

    if (nextSearch === currentSearch) {
      return
    }

    const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${currentUrl.hash}`
    window.history.replaceState(null, "", nextUrl)
  }, [inputText, targetLanguage, isTargetLanguageLoaded])

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
      if (activeElement === textarea || isEditableElement(activeElement)) return

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

  // if input or language changes
  useEffect(() => {
    const trimmedInputText = inputText.trim()
    clientRef.current?.setCurrentNormalizedInputText(normalizedInputText)

    if (!trimmedInputText) {
      clearAllRequestState(true)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setDebouncedTranslateRequest(trimmedInputText)
    }, isMobile() ? 1000 : 400)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [inputText, normalizedInputText, targetLanguage])

  // if language changes
  useEffect(() => {
    resetTranslationState(true)

    const trimmedInputText = inputText.trim()

    if (!trimmedInputText) {
      clearAllRequestState(false)
      return
    }

    setDebouncedTranslateRequest(trimmedInputText)
  }, [targetLanguage])

  useEffect(() => {
    if (!debouncedRequest || !isSocketOpen) {
      return
    }

    clientRef.current?.sendTranslateRequest(debouncedRequest)
  }, [debouncedRequest, isSocketOpen])

  useEffect(() => {
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

    if (!missingWords.length) {
      setIsDefinitionLoading(false)
      clientRef.current?.clearDefinitionRequestState()
      return
    }

    if (!isSocketOpen) return

    definitionContextRef.current = outputText
    clientRef.current?.sendDefinitionsRequest({
      words: missingWords,
      context: outputText,
      targetLanguage
    })
  }, [definitionSelectionWords, isSocketOpen, outputText, targetLanguage])

  useEffect(() => {
    if (!shouldShowGrammarPane) {
      pendingGrammarRequestTextRef.current = ""
      setGrammarExplanation("")
      setIsGrammarLoading(false)
      clientRef.current?.clearGrammarRequestState()
      return
    }

    const cachedGrammar = grammarCacheRef.current.get(outputText)

    if (cachedGrammar) {
      pendingGrammarRequestTextRef.current = ""
      setGrammarExplanation(cachedGrammar)
      setIsGrammarLoading(false)
      clientRef.current?.clearGrammarRequestState()
      return
    }

    if (!isSocketOpen) {
      return
    }

    // pendingGrammarRequestTextRef.current = outputText
    // clientRef.current?.sendGrammarRequest({
    //   text: outputText,
    //   targetLanguage
    // })
  }, [isSocketOpen, outputText, shouldShowGrammarPane, targetLanguage])

  const definitionByWord = new Map(
    wordDefinitions.map((entry) => [normalizeDefinition(entry.word), entry.definition])
  )
  const transliterationByWord = outputWords.reduce((transliterations, { word, punctuation, literal }) => {
    if (punctuation || !literal) {
      return transliterations
    }

    const transliterationKey = normalizeDefinition(word) || word

    if (!transliterations.has(transliterationKey)) {
      transliterations.set(transliterationKey, literal)
    }

    return transliterations
  }, new Map<string, string>())
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
        <button
          type="button"
          className={`title-icon-button${isTitleIconSpinning ? " title-icon-button-spinning" : ""}`}
          onClick={() => {
            setIsTitleIconSpinning(true)
            setTitleIconSpinTick((value) => value + 1)
            startTransition(() => {
              setIsPiggoLingoVisible((value) => !value)
            })
          }}
          aria-label={isPiggoLingoVisible ? "Show Piggo Translate" : "Show Piggo Lingo"}
          aria-pressed={isPiggoLingoVisible}
          disabled={isTitleIconSpinning}
        >
          <img
            key={titleIconSpinTick}
            src="favicon.svg"
            alt=""
            aria-hidden="true"
            className={`title-icon${titleIconSpinTick ? " title-icon-spinning" : ""}`}
            draggable={false}
            onAnimationEnd={() => {
              setIsTitleIconSpinning(false)
            }}
          />
        </button>
        <p className="header-title" aria-live="polite">
          <span
            className={`header-title-text${isPiggoLingoVisible ? "" : " header-title-text-visible"}`}
            aria-hidden={isPiggoLingoVisible}
          >
            Piggo Translate
          </span>
          <span
            className={`header-title-text${isPiggoLingoVisible ? " header-title-text-visible" : ""}`}
            aria-hidden={!isPiggoLingoVisible}
          >
            Piggo Lingo
          </span>
        </p>
      </section>

      {isPiggoLingoVisible ? (
        <section className="pane-stack lingo-character-grid" aria-label="Piggo Lingo HSK1 words">
          {Hsk1Characters.map(({ id, character, pinyin, definition }) => {
            const definitionPrefix = pinyin
              ? `${character} (${pinyin}) — `
              : `${character} — `

            return (
              <section
                key={id}
                className="lingo-character-card input-pane-block fade-in"
                aria-label={`HSK1 word ${character}`}
              >
                <OutputPane
                  id={`${id}-output`}
                  title=""
                  showHeader={false}
                  ariaLabel={`HSK1 word ${character}`}
                  value={character}
                  className="lingo-character-output"
                  footer={(
                    <DefinitionPane
                      id={`${id}-definition`}
                      title=""
                      showHeader={false}
                      animateOnMount
                      isEmbedded
                      className="lingo-character-definition"
                      ariaLabel={`Definition for ${character}`}
                      prefix={definitionPrefix}
                      value={definition}
                    />
                  )}
                />
              </section>
            )
          })}
        </section>
      ) : (
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
              value={outputText}
              selectionTokens={outputWords.map((token) => ({
                value: token.word,
                selectionWord: token.word,
                selectable: !token.punctuation
              }))}
              selectionWordJoiner={isSpaceSeparatedLanguage(targetLanguage) ? " " : ""}
              animateOnMount
              footer={selectedLanguageOption?.transliterate ? (
                <Transliteration
                  value={outputLiteralText}
                  isVisible={isTransliterationVisible}
                  onToggle={() => setIsTransliterationVisible((value) => !value)}
                />
              ) : null}
              enableCopyButton
              copyValue={outputText}
              enableAudioButton={!isAudioPlaying}
              isAudioLoading={isAudioLoading}
              onAudioClick={() => {
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
                  targetLanguage
                })
              }}
              className="fade-in"
              onSelectionChange={setSelectedOutputWords}
            />
          ) : null}

          {shouldShowGrammarPane && (isGrammarLoading || !!grammarExplanation) ? (
            <GrammarPane
              id="grammar-pane-title"
              title=""
              showHeader={false}
              animateOnMount
              className="fade-in"
              ariaLabel="Grammar explanation"
              value={grammarExplanation}
            />
          ) : null}

          {definitionSelectionWords.map((word, index) => {
            const normalizedWord = normalizeDefinition(word)
            const definition = definitionByWord.get(normalizedWord) || ""
            const transliterationKey = normalizedWord || word
            const rawTransliteration = transliterationByWord.get(transliterationKey) || ""
            const wordCharacters = Array.from(word)
            const isCompoundWord = wordCharacters.length > 1
            const directTransliteration = isCompoundWord
              ? rawTransliteration
              : getFormattedLiteral(rawTransliteration, targetLanguage)
            const isSingleCharacterWord = wordCharacters.length === 1
            const splitTransliteration = isSingleCharacterWord && isChineseLanguage(targetLanguage)
              ? getCharacterTransliteration(
                word,
                getTransliterationParentWord(word, definitionSelectionWords),
                transliterationByWord
              )
              : ""
            const transliteration = directTransliteration || splitTransliteration
            const shouldShowTransliterationPrefix = !!selectedLanguageOption?.transliterate && !!transliteration
            const definitionPrefix = shouldShowTransliterationPrefix
              ? `${word} (${transliteration}) — `
              : `${word} — `

            return (
              <DefinitionPane
                key={`definition-pane-${index}`}
                id={`definition-pane-${index}-title`}
                title=""
                showHeader={false}
                animateOnMount
                className="fade-in"
                ariaLabel={`Definition for ${word}`}
                prefix={definitionPrefix}
                value={definition}
              />
            )
          })}
        </section>
      )}

      {isLocal() && !isMobile() && (
        <span className="app-version" aria-label="App version">
          v0.5.2
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

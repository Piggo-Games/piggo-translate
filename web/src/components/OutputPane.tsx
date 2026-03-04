import { ReactNode, useEffect, useRef, useState } from "react"
import { isMobile } from "@piggo-translate/web"
import {
  PaneSelectionToken, buildSelectableDisplayText, copyTextToClipboard,
  getAnimatedSelectableTokens, getDynamicIntervalDuration, getSelectionWord,
  selectableOutputTokenPattern
} from "./paneUtils"

type OutputPaneProps = {
  id: string
  title: string
  ariaLabel: string
  value: string
  className?: string
  footer?: ReactNode
  showHeader: boolean
  onSelectionChange?: (selectionWords: string[]) => void
  animateOnMount?: boolean
  selectionWords?: string[]
  selectionTokens?: PaneSelectionToken[]
  selectionWordJoiner?: string
  enableCopyButton?: boolean
  copyValue?: string
  enableAudioButton?: boolean
  isAudioLoading?: boolean
  onAudioClick?: () => void
}

const OutputPane = ({
  id, title, ariaLabel, value, className, footer, showHeader, onSelectionChange,
  animateOnMount, selectionWords, selectionTokens, selectionWordJoiner = " ", enableCopyButton,
  copyValue, enableAudioButton, isAudioLoading, onAudioClick
}: OutputPaneProps) => {
  const textContentRef = useRef<HTMLDivElement | null>(null)
  const lastSelectionRef = useRef("")
  const shouldAnimateOnMountRef = useRef(!!animateOnMount)
  const [didCopy, setDidCopy] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  const [isCopySelected, setIsCopySelected] = useState(false)
  const copySelectedTimeoutRef = useRef<number | null>(null)
  const paneClassName = ["output-pane", className].filter(Boolean).join(" ")
  const isMobileDevice = isMobile()
  const shouldRenderDesktopCopyButton = !!enableCopyButton && !isMobileDevice
  const shouldRenderMobileCopyButton = !!enableCopyButton && isMobileDevice
  const isEditableActiveElement = () => {
    const activeElement = document.activeElement

    if (!(activeElement instanceof HTMLElement)) {
      return false
    }

    if (activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement) {
      return !activeElement.readOnly && !activeElement.disabled
    }

    return activeElement.isContentEditable
  }

  const normalizedSelectionTokens =
    selectionTokens && selectionTokens.length
      ? selectionTokens
      : selectionWords && selectionWords.length
        ? selectionWords.map((tokenValue) => {
          const selectionWord = getSelectionWord(tokenValue)
          return {
            value: tokenValue,
            selectionWord,
            selectable: !!selectionWord
          }
        })
        : []

  const shouldUseSelectionTokens = normalizedSelectionTokens.length > 0
  const shouldUseWordJoiner = shouldUseSelectionTokens && normalizedSelectionTokens.length > 1
  const selectableTextTarget = shouldUseSelectionTokens
    ? buildSelectableDisplayText(normalizedSelectionTokens, shouldUseWordJoiner, selectionWordJoiner)
    : value

  const initialText = shouldAnimateOnMountRef.current ? "" : selectableTextTarget
  const [text, setText] = useState(initialText)
  const [desiredText, setDesiredText] = useState(selectableTextTarget)

  const staticSelectableTokens = shouldUseSelectionTokens
    ? normalizedSelectionTokens
    : (text.match(selectableOutputTokenPattern) ?? []).map((tokenValue) => {
      const selectionWord = getSelectionWord(tokenValue)
      return {
        value: tokenValue,
        selectionWord,
        selectable: !!selectionWord
      }
    })
  const selectableWordCount = staticSelectableTokens.reduce((count, token) => {
    const selectionWord = token.selectionWord ?? getSelectionWord(token.value)
    const isSelectableToken = token.selectable ?? !!selectionWord
    return isSelectableToken && !!selectionWord ? count + 1 : count
  }, 0)
  const shouldDisableSingleWordSelection = selectableWordCount === 1

  const selectableTokens = shouldUseSelectionTokens
    ? getAnimatedSelectableTokens(
      staticSelectableTokens,
      text,
      shouldUseWordJoiner,
      selectionWordJoiner
    )
    : staticSelectableTokens

  useEffect(() => {
    if (shouldAnimateOnMountRef.current) {
      shouldAnimateOnMountRef.current = false
    }

    setDesiredText(selectableTextTarget)
  }, [selectableTextTarget])

  useEffect(() => {
    if (!desiredText) {
      setText("")
    }
  }, [desiredText])

  useEffect(() => {
    if (text === desiredText) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setText((currentText) => {
        const nextDesiredText = desiredText

        if (currentText === nextDesiredText) {
          return currentText
        }

        const desiredPrefix = nextDesiredText.slice(0, currentText.length)

        if (currentText !== desiredPrefix) {
          return currentText.slice(0, -1)
        }

        return nextDesiredText.slice(0, currentText.length + 1)
      })
    }, getDynamicIntervalDuration(text, desiredText))

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [desiredText, text])

  useEffect(() => {
    if (!onSelectionChange) {
      return
    }

    const getTokenElementFromNode = (node: Node | null) => {
      if (!node) {
        return null
      }

      const element = node instanceof Element ? node : node.parentElement
      return element?.closest<HTMLSpanElement>(".output-pane-text-token") ?? null
    }

    const updateSelectedTokenStyles = (range: Range | null) => {
      const contentElement = textContentRef.current

      if (!contentElement) {
        return
      }

      const tokenElements = Array.from(contentElement.querySelectorAll<HTMLSpanElement>(".output-pane-text-token"))
      tokenElements.forEach((tokenElement) => {
        tokenElement.classList.remove("output-pane-text-token-selected")
        tokenElement.classList.remove("output-pane-text-token-selected-start")
        tokenElement.classList.remove("output-pane-text-token-selected-end")
      })

      if (!range || range.collapsed) {
        return
      }

      tokenElements.forEach((tokenElement) => {
        if (range.intersectsNode(tokenElement)) {
          tokenElement.classList.add("output-pane-text-token-selected")
        }
      })

      tokenElements.forEach((tokenElement, tokenIndex) => {
        const isSelected = tokenElement.classList.contains("output-pane-text-token-selected")
        const isPreviousSelected = tokenElements[tokenIndex - 1]?.classList.contains("output-pane-text-token-selected")
        const isNextSelected = tokenElements[tokenIndex + 1]?.classList.contains("output-pane-text-token-selected")

        if (isSelected && !isPreviousSelected) {
          tokenElement.classList.add("output-pane-text-token-selected-start")
        }

        if (isSelected && !isNextSelected) {
          tokenElement.classList.add("output-pane-text-token-selected-end")
        }
      })
    }

    const clearSelection = () => {
      if (!lastSelectionRef.current) {
        return
      }

      lastSelectionRef.current = ""
      onSelectionChange([])
    }

    const handleSelectionChange = () => {
      const contentElement = textContentRef.current
      const selection = window.getSelection()

      if (!contentElement || !selection || selection.rangeCount === 0) {
        return
      }

      const range = selection.getRangeAt(0)
      const isSelectionInsideText =
        contentElement.contains(range.startContainer) &&
        contentElement.contains(range.endContainer)

      if (!isSelectionInsideText) {
        return
      }

      if (selection.isCollapsed) {
        return
      }

      const tokenElements = Array.from(contentElement.querySelectorAll<HTMLSpanElement>(".output-pane-text-token"))
      const anchorTokenElement = getTokenElementFromNode(selection.anchorNode)
      const focusTokenElement = getTokenElementFromNode(selection.focusNode)
      const selectedTokenElement =
        [anchorTokenElement, focusTokenElement].find((tokenElement) =>
          !!tokenElement &&
          contentElement.contains(tokenElement) &&
          !!tokenElement.dataset.selectionWord
        ) ||
        tokenElements.find((tokenElement) =>
          range.intersectsNode(tokenElement) &&
          !!tokenElement.dataset.selectionWord
        ) ||
        null

      if (!selectedTokenElement) {
        updateSelectedTokenStyles(null)
        clearSelection()
        return
      }

      const selectedWord = selectedTokenElement.dataset.selectionWord || getSelectionWord(selectedTokenElement.textContent || "")
      const nextSelectionKey = selectedWord

      if (!nextSelectionKey) {
        updateSelectedTokenStyles(null)
        clearSelection()
        return
      }

      const normalizedRange = document.createRange()
      normalizedRange.selectNodeContents(selectedTokenElement)
      selection.removeAllRanges()
      selection.addRange(normalizedRange)
      updateSelectedTokenStyles(normalizedRange)

      if (nextSelectionKey === lastSelectionRef.current) {
        return
      }

      lastSelectionRef.current = nextSelectionKey
      onSelectionChange([selectedWord])
    }

    document.addEventListener("selectionchange", handleSelectionChange)

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange)
    }
  }, [onSelectionChange])

  const clearSelectableOutputSelection = () => {
    if (!onSelectionChange) {
      return
    }

    const selection = window.getSelection()
    if (selection && !isEditableActiveElement()) {
      selection.removeAllRanges()
    }

    const contentElement = textContentRef.current

    if (contentElement) {
      const tokenElements = Array.from(contentElement.querySelectorAll<HTMLSpanElement>(".output-pane-text-token"))
      tokenElements.forEach((tokenElement) => {
        tokenElement.classList.remove("output-pane-text-token-selected")
        tokenElement.classList.remove("output-pane-text-token-selected-start")
        tokenElement.classList.remove("output-pane-text-token-selected-end")
      })
    }

    if (!lastSelectionRef.current) {
      return
    }

    lastSelectionRef.current = ""
    onSelectionChange([])
  }

  const selectToken = (tokenElement: HTMLSpanElement) => {
    const tokenSelectionWord =
      tokenElement.dataset.selectionWord || getSelectionWord(tokenElement.textContent || "")

    if (tokenSelectionWord && tokenSelectionWord === lastSelectionRef.current) {
      clearSelectableOutputSelection()
      return
    }

    const selection = window.getSelection()

    if (!selection) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(tokenElement)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  useEffect(() => {
    clearSelectableOutputSelection()
  }, [value])

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }

      if (copySelectedTimeoutRef.current) {
        window.clearTimeout(copySelectedTimeoutRef.current)
      }
    }
  }, [])

  return (
    <section
      className={paneClassName}
      aria-labelledby={showHeader ? id : undefined}
      aria-label={showHeader ? undefined : ariaLabel}
    >
      {showHeader ? (
        <div className="output-pane-header">
          <h2 id={id}>{title}</h2>
        </div>
      ) : null}

      <div
        ref={textContentRef}
        className="output-pane-text-content output-pane-text-content-selectable"
        role="textbox"
        aria-label={ariaLabel}
      >
        {selectableTokens.map((token, tokenIndex) => {
          const tokenValue = token.value
          const isWhitespaceToken = !tokenValue.trim()
          const selectionWord = token.selectionWord ?? getSelectionWord(tokenValue)
          const isSelectableToken = (token.selectable ?? !!selectionWord) && !shouldDisableSingleWordSelection
          const tokenClassName = [
            "output-pane-text-token",
            isWhitespaceToken ? "output-pane-text-token-space" : "",
            isSelectableToken ? "output-pane-text-token-selectable" : "output-pane-text-token-nonselectable"
          ].filter(Boolean).join(" ")

          return (
            <span key={`${tokenValue}-${tokenIndex}`}>
              <span
                className={tokenClassName}
                data-selection-word={isSelectableToken ? selectionWord : ""}
                onPointerDown={(event) => {
                  if (isWhitespaceToken || !isSelectableToken || shouldDisableSingleWordSelection) {
                    return
                  }

                  event.preventDefault()
                  selectToken(event.currentTarget)
                }}
              >
                {tokenValue}
              </span>
              {shouldUseWordJoiner && tokenIndex < selectableTokens.length - 1 ? selectionWordJoiner : null}
            </span>
          )
        })}
      </div>

      {footer ? footer : null}

      {enableAudioButton || shouldRenderDesktopCopyButton ? (
        <div className="output-pane-actions">
          {enableAudioButton ? (
            <button
              type="button"
              className={`output-pane-action-button output-pane-audio-button${isAudioLoading ? " output-pane-action-button-loading" : ""}`}
              aria-label="Generate speech audio"
              title={isAudioLoading ? "Generating audio..." : "Speak"}
              disabled={!!isAudioLoading}
              onPointerDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                onAudioClick?.()
              }}
            >
              {isAudioLoading ? (
                <span className="spinner output-pane-action-spinner" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                  <path d="M15 9.5a4 4 0 0 1 0 5" />
                  <path d="M18 7a8 8 0 0 1 0 10" />
                </svg>
              )}
            </button>
          ) : null}
          {shouldRenderDesktopCopyButton ? (
            <button
              type="button"
              className={`output-pane-action-button${didCopy ? " output-pane-copy-button-copied" : ""}${isCopySelected ? " output-pane-copy-button-selected" : ""}`}
              aria-label="Copy output text"
              title={didCopy ? "Copied" : "Copy"}
              onPointerDown={(event) => {
                event.preventDefault()
              }}
              onClick={async () => {
                const copied = await copyTextToClipboard(copyValue ?? value)

                if (!copied) {
                  return
                }

                setDidCopy(true)
                setIsCopySelected(true)

                if (copySelectedTimeoutRef.current) {
                  window.clearTimeout(copySelectedTimeoutRef.current)
                }

                copySelectedTimeoutRef.current = window.setTimeout(() => {
                  setIsCopySelected(false)
                }, 200)

                if (copyFeedbackTimeoutRef.current) {
                  window.clearTimeout(copyFeedbackTimeoutRef.current)
                }

                copyFeedbackTimeoutRef.current = window.setTimeout(() => {
                  setDidCopy(false)
                }, 1000)
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 8h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" />
                <path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      {shouldRenderMobileCopyButton ? (
        <div className="output-pane-actions output-pane-actions-left">
          <button
            type="button"
            className={`output-pane-action-button${didCopy ? " output-pane-copy-button-copied" : ""}${isCopySelected ? " output-pane-copy-button-selected" : ""}`}
            aria-label="Copy output text"
            title={didCopy ? "Copied" : "Copy"}
            onPointerDown={(event) => {
              event.preventDefault()
            }}
            onClick={async () => {
              const copied = await copyTextToClipboard(copyValue ?? value)

              if (!copied) {
                return
              }

              setDidCopy(true)
              setIsCopySelected(true)

              if (copySelectedTimeoutRef.current) {
                window.clearTimeout(copySelectedTimeoutRef.current)
              }

              copySelectedTimeoutRef.current = window.setTimeout(() => {
                setIsCopySelected(false)
              }, 200)

              if (copyFeedbackTimeoutRef.current) {
                window.clearTimeout(copyFeedbackTimeoutRef.current)
              }

              copyFeedbackTimeoutRef.current = window.setTimeout(() => {
                setDidCopy(false)
              }, 1000)
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 8h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" />
              <path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      ) : null}
    </section>
  )
}

export { OutputPane }

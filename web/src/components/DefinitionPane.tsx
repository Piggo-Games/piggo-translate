import { useEffect, useRef, useState } from "react"
import { getDynamicIntervalDuration } from "./paneUtils"

const definitionSeparator = " — "

const splitDefinitionValue = (value: string) => {
  const separatorIndex = value.indexOf(definitionSeparator)

  if (separatorIndex === -1) {
    return {
      prefixText: value,
      suffixText: ""
    }
  }

  return {
    prefixText: value.slice(0, separatorIndex + definitionSeparator.length),
    suffixText: value.slice(separatorIndex + definitionSeparator.length)
  }
}

type DefinitionPaneProps = {
  id: string
  title: string
  ariaLabel: string
  value: string
  className?: string
  showHeader: boolean
  animateOnMount?: boolean
  isEmbedded?: boolean
}

const DefinitionPane = ({
  id, title, ariaLabel, value, className, showHeader, animateOnMount, isEmbedded
}: DefinitionPaneProps) => {
  const shouldAnimateOnMountRef = useRef(!!animateOnMount)
  const initialParts = splitDefinitionValue(value)
  const previousPrefixTextRef = useRef(initialParts.prefixText)
  const paneClassName = [
    "definition-pane",
    isEmbedded ? "definition-pane-embedded" : "",
    className
  ].filter(Boolean).join(" ")
  const PaneTag = isEmbedded ? "div" : "section"
  const [prefixText, setPrefixText] = useState(initialParts.prefixText)
  const initialSuffixText = shouldAnimateOnMountRef.current ? "" : initialParts.suffixText
  const [text, setText] = useState(initialSuffixText)
  const [desiredText, setDesiredText] = useState(initialParts.suffixText)
  const [fadeVersion, setFadeVersion] = useState(0)
  const [isFadeVisible, setIsFadeVisible] = useState(false)

  useEffect(() => {
    if (shouldAnimateOnMountRef.current) {
      shouldAnimateOnMountRef.current = false
    }

    const nextParts = splitDefinitionValue(value)
    const didPrefixChange = previousPrefixTextRef.current !== nextParts.prefixText

    setPrefixText(nextParts.prefixText)

    if (didPrefixChange) {
      setText("")
    }

    setDesiredText(nextParts.suffixText)
    setFadeVersion((currentVersion) => currentVersion + 1)
    previousPrefixTextRef.current = nextParts.prefixText
  }, [value])

  useEffect(() => {
    setIsFadeVisible(false)

    const animationFrameId = window.requestAnimationFrame(() => {
      setIsFadeVisible(true)
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [fadeVersion])

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

  return (
    <PaneTag
      className={paneClassName}
      aria-labelledby={showHeader ? id : undefined}
      aria-label={showHeader ? undefined : ariaLabel}
    >
      {showHeader ? (
        <div className="definition-pane-header">
          <h2 id={id}>{title}</h2>
        </div>
      ) : null}

      <div
        className="definition-pane-text-content definition-pane-text-content-selectable"
        role="textbox"
        aria-label={ariaLabel}
      >
        {prefixText}
        <span
          key={fadeVersion}
          className={`definition-pane-value-fade-in${isFadeVisible ? " is-visible" : ""}`}
        >
          {text}
        </span>
      </div>
    </PaneTag>
  )
}

export { DefinitionPane }

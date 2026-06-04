import { useEffect, useRef, useState } from "react"

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
  prefix?: string
  className?: string
  showHeader: boolean
  animateOnMount?: boolean
  isEmbedded?: boolean
}

const DefinitionPane = ({
  id, title, ariaLabel, value, prefix, className, showHeader, animateOnMount, isEmbedded
}: DefinitionPaneProps) => {
  const shouldAnimateOnMountRef = useRef(!!animateOnMount)
  const initialParts = prefix === undefined
    ? splitDefinitionValue(value)
    : { prefixText: prefix, suffixText: value }
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
  const [fadeVersion, setFadeVersion] = useState(0)
  const [isFadeVisible, setIsFadeVisible] = useState(false)

  useEffect(() => {
    if (shouldAnimateOnMountRef.current) {
      shouldAnimateOnMountRef.current = false
    }

    const nextParts = prefix === undefined
      ? splitDefinitionValue(value)
      : { prefixText: prefix, suffixText: value }
    const didPrefixChange = previousPrefixTextRef.current !== nextParts.prefixText

    setIsFadeVisible(false)
    setPrefixText(nextParts.prefixText)

    if (didPrefixChange) {
      setText("")
    }

    setText(nextParts.suffixText)
    setFadeVersion((currentVersion) => currentVersion + 1)
    previousPrefixTextRef.current = nextParts.prefixText
  }, [prefix, value])

  useEffect(() => {
    if (!text) {
      setIsFadeVisible(false)
      return
    }

    let nextAnimationFrameId = 0
    const animationFrameId = window.requestAnimationFrame(() => {
      nextAnimationFrameId = window.requestAnimationFrame(() => {
        setIsFadeVisible(true)
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.cancelAnimationFrame(nextAnimationFrameId)
    }
  }, [fadeVersion, text])

  useEffect(() => {
    if (!value) {
      setText("")
    }
  }, [value])

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

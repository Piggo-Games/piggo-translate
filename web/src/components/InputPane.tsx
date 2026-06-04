import { MutableRefObject, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react"

type InputPaneProps = {
  id: string
  title: string
  placeholder: string
  ariaLabel: string
  value: string
  maxLength?: number
  className?: string
  afterTextarea?: ReactNode
  footer?: ReactNode
  autoFocus: boolean
  onChange?: (value: string) => void
  showHeader: boolean
  textareaRef?: MutableRefObject<HTMLTextAreaElement | null>
}

const InputPane = ({
  id, title, placeholder, ariaLabel, value, maxLength, className, afterTextarea, footer, autoFocus,
  onChange, showHeader, textareaRef
}: InputPaneProps) => {
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [text, setText] = useState(value)
  const paneClassName = ["input-pane", className].filter(Boolean).join(" ")

  useEffect(() => {
    setText(value)
  }, [value])

  useLayoutEffect(() => {
    const textarea = localTextareaRef.current
    if (!textarea) return

    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [text])

  return (
    <section
      className={paneClassName}
      aria-labelledby={showHeader ? id : undefined}
      aria-label={showHeader ? undefined : ariaLabel}
    >
      {showHeader ? (
        <div className="input-pane-header">
          <h2 id={id}>{title}</h2>
        </div>
      ) : null}

      <textarea
        ref={(node) => {
          localTextareaRef.current = node

          if (textareaRef) {
            textareaRef.current = node
          }
        }}
        className="input-pane-textarea"
        rows={1}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={text}
        maxLength={maxLength}
        readOnly={false}
        autoFocus={autoFocus}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const nextValue = event.target.value

          setText(nextValue)
          onChange?.(nextValue)
        }}
      />

      {afterTextarea}
      {footer ? footer : null}
    </section>
  )
}

export { InputPane }

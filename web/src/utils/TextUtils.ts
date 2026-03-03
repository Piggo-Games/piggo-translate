export const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

const definitionWordStripPattern = /[^\p{L}\p{M}\p{N}\p{Script=Han}-]+/gu

export const normalizeDefinition = (word: string) => word.replace(definitionWordStripPattern, "")

export const getSelectionWord = (value: string) => value.replace(definitionWordStripPattern, "")

export const copyTextToClipboard = async (value: string) => {
  if (!value) {
    return false
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fallback handled below for unsupported or blocked clipboard writes
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.setAttribute("readonly", "true")
  document.body.appendChild(textarea)
  textarea.select()

  try {
    const copied = document.execCommand("copy")
    document.body.removeChild(textarea)
    return copied
  } catch {
    document.body.removeChild(textarea)
    return false
  }
}

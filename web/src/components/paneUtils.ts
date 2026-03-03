export { copyTextToClipboard, getSelectionWord } from "../utils/TextUtils"

const textPaneAnimationMinIntervalMs = 15
const textPaneAnimationMaxIntervalMs = 90
const textPaneAnimationFastThreshold = 24

export const selectableOutputTokenPattern = /[\p{Script=Han}]|[^\s\p{Script=Han}]+|\s+/gu

export type PaneSelectionToken = {
  value: string
  selectionWord?: string
  selectable?: boolean
}

const getSharedPrefixLength = (left: string, right: string) => {
  const maxLength = Math.min(left.length, right.length)
  let index = 0

  while (index < maxLength && left[index] === right[index]) {
    index += 1
  }

  return index
}

const getAnimationWorkLeft = (currentText: string, desiredText: string) => {
  const sharedPrefixLength = getSharedPrefixLength(currentText, desiredText)
  const deleteSteps = currentText.length - sharedPrefixLength
  const addSteps = desiredText.length - sharedPrefixLength

  return deleteSteps + addSteps
}

export const getDynamicIntervalDuration = (currentText: string, desiredText: string) => {
  const workLeft = getAnimationWorkLeft(currentText, desiredText)

  if (workLeft <= 1) {
    return textPaneAnimationMaxIntervalMs
  }

  const clampedProgress = Math.min((workLeft - 1) / (textPaneAnimationFastThreshold - 1), 1)
  const intervalRange = textPaneAnimationMaxIntervalMs - textPaneAnimationMinIntervalMs

  return Math.round(textPaneAnimationMaxIntervalMs - (intervalRange * clampedProgress))
}

export const buildSelectableDisplayText = (
  tokens: PaneSelectionToken[],
  shouldUseWordJoiner: boolean,
  selectionWordJoiner: string
) => {
  if (!tokens.length) {
    return ""
  }

  return tokens.reduce((result, token, tokenIndex) => {
    const joiner =
      shouldUseWordJoiner && tokenIndex < tokens.length - 1 ? selectionWordJoiner : ""
    return `${result}${token.value}${joiner}`
  }, "")
}

export const getAnimatedSelectableTokens = (
  targetTokens: PaneSelectionToken[],
  animatedText: string,
  shouldUseWordJoiner: boolean,
  selectionWordJoiner: string
) => {
  if (!targetTokens.length || !animatedText) {
    return []
  }

  let remainingText = animatedText

  const nextTokens = targetTokens.flatMap((token, tokenIndex) => {
    if (!remainingText) {
      return []
    }

    const visibleTokenValue = remainingText.slice(0, token.value.length)
    remainingText = remainingText.slice(visibleTokenValue.length)
    const tokenEntries: PaneSelectionToken[] = []
    const isTokenFullyVisible = visibleTokenValue.length === token.value.length

    if (visibleTokenValue) {
      tokenEntries.push({
        value: visibleTokenValue,
        selectionWord: isTokenFullyVisible ? token.selectionWord : "",
        selectable: isTokenFullyVisible ? token.selectable : false
      })
    }

    const shouldAppendJoiner =
      shouldUseWordJoiner &&
      tokenIndex < targetTokens.length - 1 &&
      !!selectionWordJoiner

    if (shouldAppendJoiner && remainingText) {
      const visibleJoinerValue = remainingText.slice(0, selectionWordJoiner.length)

      if (visibleJoinerValue) {
        tokenEntries.push({
          value: visibleJoinerValue,
          selectionWord: "",
          selectable: false
        })
        remainingText = remainingText.slice(visibleJoinerValue.length)
      }
    }

    return tokenEntries
  })

  return nextTokens
}

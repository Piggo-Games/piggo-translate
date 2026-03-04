export type Language = {
  label: string
  value: string
  transliterate: boolean
}

export const Languages: Language[] = [
  { label: "Chinese", value: "Chinese (simplified)", transliterate: true },
  { label: "English", value: "English", transliterate: false },
  { label: "Spanish", value: "Spanish", transliterate: false },
  { label: "Japanese", value: "Japanese", transliterate: true },
  { label: "Russian", value: "Russian", transliterate: true },
  { label: "French", value: "French", transliterate: false },
  // { label: "Italian", value: "Italian", transliterate: false },
  // { label: "Korean", value: "Korean", transliterate: true },
]

const pinyinToneMarkedVowels = new Set([
  "a", "ā", "á", "ǎ", "à",
  "e", "ē", "é", "ě", "è",
  "i", "ī", "í", "ǐ", "ì",
  "o", "ō", "ó", "ǒ", "ò",
  "u", "ū", "ú", "ǔ", "ù",
  "ü", "ǖ", "ǘ", "ǚ", "ǜ",
  "v", "A", "Ā", "Á", "Ǎ", "À",
  "E", "Ē", "É", "Ě", "È",
  "I", "Ī", "Í", "Ǐ", "Ì",
  "O", "Ō", "Ó", "Ǒ", "Ò",
  "U", "Ū", "Ú", "Ǔ", "Ù",
  "V", "Ǖ", "Ǘ", "Ǚ", "Ǜ"
])

const isPinyinVowel = (character: string) => {
  if (character.length !== 1) return false
  return pinyinToneMarkedVowels.has(character)
}

const isPinyinConsonant = (character: string) => {
  if (character.length !== 1) return false
  return !isPinyinVowel(character) && /[a-zA-Z]/.test(character)
}

const isPinyinSyllableBoundary = (token: string, index: number) => {
  if (index < 1 || index >= token.length - 1) return false

  const previousCharacter = token[index - 1]
  const currentCharacter = token[index]
  const nextCharacter = token[index + 1]
  const nextNextCharacter = token[index + 2]

  const isNextCharacterStartOfSyllable = isPinyinVowel(nextCharacter) ||
    ((currentCharacter === "s" || currentCharacter === "z" || currentCharacter === "c") &&
    nextCharacter === "h" &&
    isPinyinVowel(nextNextCharacter))

  if (!isPinyinConsonant(currentCharacter) || !isNextCharacterStartOfSyllable) {
    return false
  }

  if (isPinyinVowel(previousCharacter)) return true

  if (previousCharacter === "n") {
    return isPinyinVowel(token[index - 2] || "")
  }

  if (previousCharacter === "g") {
    return token[index - 2] === "n" && isPinyinVowel(token[index - 3] || "")
  }

  return false
}

export const splitPinyin = (value: string): string[] => {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return []
  }

  const tokensBySpace = trimmedValue.split(/\s+/).map((value) => value.trim()).filter(Boolean)
  if (tokensBySpace.length > 1) {
    return tokensBySpace
  }

  const tokensByApostrophe = trimmedValue.split("'").map((value) => value.trim()).filter(Boolean)
  if (tokensByApostrophe.length > 1) {
    return tokensByApostrophe
  }

  const token = tokensBySpace[0] || tokensByApostrophe[0] || trimmedValue
  if (!token) return []

  const splitAt: number[] = []
  let sawFirstVowel = false

  for (let index = 0; index < token.length; index += 1) {
    const character = token[index]
    if (isPinyinVowel(character)) {
      sawFirstVowel = true
    }

    if (!sawFirstVowel || index < 1 || index >= token.length - 1) {
      continue
    }

    const previousCharacter = token[index - 1]
    const currentCharacter = character
    const isDoubleConsonant =
      previousCharacter === currentCharacter &&
      isPinyinConsonant(previousCharacter) &&
      isPinyinConsonant(currentCharacter)
    const isBoundary = isPinyinSyllableBoundary(token, index)

    if (isDoubleConsonant || isBoundary) {
      splitAt.push(index)
      sawFirstVowel = false
    }
  }

  if (!splitAt.length) {
    return [token]
  }

  const pieces: string[] = []
  let start = 0

  splitAt.forEach((splitIndex) => {
    const piece = token.slice(start, splitIndex)
    if (piece) {
      pieces.push(piece)
    }
    start = splitIndex
  })

  const trailingPiece = token.slice(start)
  if (trailingPiece) {
    pieces.push(trailingPiece)
  }

  return pieces.filter(Boolean)
}

export type LanguageCode = "zh" | "en" | "es" | "ja" | "ru" | "fr"
export type LanguageValue = "Chinese (simplified)" | "English" | "Spanish" | "Japanese" | "Russian" | "French"

export type Language = {
  label: string
  code: LanguageCode
  value: LanguageValue
  transliterate: boolean
}

export const Languages: Language[] = [
  { code: "zh", label: "Chinese", value: "Chinese (simplified)", transliterate: true },
  { code: "en", label: "English", value: "English", transliterate: false },
  { code: "es", label: "Spanish", value: "Spanish", transliterate: false },
  { code: "ja", label: "Japanese", value: "Japanese", transliterate: true },
  { code: "ru", label: "Russian", value: "Russian", transliterate: true },
  { code: "fr", label: "French", value: "French", transliterate: false }
]

export type LanguageValueLower = Lowercase<LanguageValue>

export const isLanguageCode = (value: string): boolean => {
  return ["zh", "en", "es", "ja", "ru", "fr"].includes(value)
}

export const languageCodeToValue = (code: LanguageCode): LanguageValue => {
  const map: Record<LanguageCode, LanguageValue> = {
    zh: "Chinese (simplified)",
    en: "English",
    es: "Spanish",
    ja: "Japanese",
    ru: "Russian",
    fr: "French"
  }
  return map[code]
}

export const languageValueToCode = (value: LanguageValueLower): LanguageCode => {
  const map: Record<LanguageValueLower, LanguageCode> = {
    "chinese (simplified)": "zh",
    "english": "en",
    "spanish": "es",
    "japanese": "ja",
    "russian": "ru",
    "french": "fr"
  }
  return map[value]
}

export const isLanguageValueLower = (value: string): boolean => {
  return ["chinese (simplified)", "english", "spanish", "japanese", "russian", "french"].includes(value)
}

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

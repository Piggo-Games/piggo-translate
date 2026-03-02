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

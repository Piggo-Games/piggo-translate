import { normalizeText } from "../utils/TextUtils"

export type Audio = {
  audioBase64: string
  mimeType: string
}

export type AudioCache = {
  get: (text: string) => Audio | null
  set: (params: { text: string, audioBase64: string, mimeType: string }) => void
  clear: () => void
}

export const AudioCache = (): AudioCache => {
  const cache: Record<string, Audio> = {}

  const get = (text: string) => {
    const key = normalizeText(text)
    return cache[key] || null
  }

  const set = (params: { text: string, audioBase64: string, mimeType: string }) => {
    const key = normalizeText(params.text)

    if (!key || !params.audioBase64) {
      return
    }

    cache[key] = {
      audioBase64: params.audioBase64,
      mimeType: params.mimeType
    }
  }

  const clear = () => {
    Object.keys(cache).forEach((key) => {
      delete cache[key]
    })
  }

  return {
    get,
    set,
    clear
  }
}

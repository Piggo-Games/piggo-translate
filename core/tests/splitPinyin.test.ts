import { describe, expect, test } from "bun:test"
import { splitPinyin } from "../src/Languages"

describe("splitPinyin", () => {
  const cases = [
    {
      name: "returns empty for empty input",
      value: "",
      expected: [],
    },
    {
      name: "returns empty for whitespace-only input",
      value: "   \t  ",
      expected: [],
    },
    {
      name: "splits on spaces after trimming",
      value: "  nǐ   hǎo  ",
      expected: ["nǐ", "hǎo"],
    },
    {
      name: "splits on apostrophes after no spaces",
      value: "xióng'jiāo",
      expected: ["xióng", "jiāo"],
    },
    {
      name: "ignores empty apostrophe fragments after trim",
      value: "'xióng''jiāo'",
      expected: ["xióng", "jiāo"],
    },
    {
      name: "keeps space splitting ahead of apostrophe splitting",
      value: "ni hao'jiāo",
      expected: ["ni", "hao'jiāo"],
    },
    {
      name: "splits at repeated consonants after a vowel",
      value: "mǎppa",
      expected: ["mǎp", "pa"],
    },
    {
      name: "does not split repeated consonants before a vowel",
      value: "ppāo",
      expected: ["ppāo"],
    },
    {
      name: "does not split repeated consonants at the end",
      value: "maapp",
      expected: ["maapp"],
    },
    {
      name: "splits when a new syllable starts with a consonant after a vowel",
      value: "Hóngsè",
      expected: ["Hóng", "sè"],
    },
    {
      name: "splits tone-marked Lǜsè into two syllables",
      value: "Lǜsè",
      expected: ["Lǜ", "sè"],
    },
    {
      name: "splits a two-syllable word after n",
      value: "shǎnshù",
      expected: ["shǎn", "shù"],
    }
  ]

  cases.forEach(({ name, value, expected }) => {
    test(name, () => {
      expect(splitPinyin(value)).toEqual(expected)
    })
  })
})

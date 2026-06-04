import { describe, expect, test } from "bun:test"
import {
  buildRealtimeResponseCreate, buildRealtimeSessionUpdate, OpenAiTranslator, parseStructuredDefinitions, translationOutputTool
} from "../src/translate/OpenAiTranslator"

describe("OpenAI Realtime GA events", () => {
  test("builds the GA session update shape", () => {
    expect(buildRealtimeSessionUpdate("sage")).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          output: {
            voice: "sage",
            format: {
              type: "audio/pcm",
              rate: 24000
            }
          }
        }
      }
    })
  })

  test("builds text responses with GA output modalities", () => {
    const event = buildRealtimeResponseCreate({
      prompt: "hello",
      instructions: "translate",
      outputModalities: ["text"]
    })

    expect(event).toEqual({
      type: "response.create",
      response: {
        conversation: "none",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "hello"
              }
            ]
          }
        ],
        output_modalities: ["text"],
        max_output_tokens: 1024,
        instructions: "translate"
      }
    })
    expect("modalities" in event.response).toBe(false)
  })

  test("builds text responses with a forced structured output function tool", () => {
    const event = buildRealtimeResponseCreate({
      prompt: "hello",
      instructions: "translate",
      outputModalities: ["text"],
      structuredOutputTool: translationOutputTool
    })

    expect(event.response).toMatchObject({
      conversation: "none",
      output_modalities: ["text"],
      instructions: "translate",
      tools: [translationOutputTool],
      tool_choice: {
        type: "function",
        name: "return_translation"
      }
    })
  })

  test("builds audio responses with one output modality and nested audio config", () => {
    const event = buildRealtimeResponseCreate({
      prompt: "bonjour",
      instructions: "speak",
      outputModalities: ["audio"],
      audioVoice: "sage",
      maxOutputTokens: 256
    })

    expect(event).toEqual({
      type: "response.create",
      response: {
        conversation: "none",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "bonjour"
              }
            ]
          }
        ],
        output_modalities: ["audio"],
        max_output_tokens: 256,
        instructions: "speak",
        audio: {
          output: {
            voice: "sage",
            format: {
              type: "audio/pcm",
              rate: 24000
            }
          }
        }
      }
    })
  })
})

describe("parseStructuredDefinitions", () => {
  test("returns consolidated definitions for a requested word list", () => {
    const result = parseStructuredDefinitions(
      JSON.stringify({
        definitions: [
          { word: "你", definition: "second-person pronoun" },
          { word: "好", definition: "good; well" }
        ]
      }),
      ["你", "好"]
    )

    expect(result).toEqual({
      definitions: [
        { word: "你", definition: "second-person pronoun" },
        { word: "好", definition: "good; well" }
      ]
    })
  })

  test("accepts an array of definitions from realtime output", () => {
    const result = parseStructuredDefinitions(
      JSON.stringify([
        { word: "你", definition: "second-person pronoun" },
        { word: "好", definition: "good; well" }
      ]),
      ["你", "好"]
    )

    expect(result).toEqual({
      definitions: [
        { word: "你", definition: "second-person pronoun" },
        { word: "好", definition: "good; well" }
      ]
    })
  })

  test("throws when a requested word is missing from the structured response", () => {
    expect(() => {
      parseStructuredDefinitions(
        JSON.stringify({
          definitions: [
            { word: "你", definition: "second-person pronoun" }
          ]
        }),
        ["你", "好"]
      )
    }).toThrow("missing definitions for: 好")
  })
})

const integrationTest = process.env.OPENAI_API_KEY ? test : test.skip

describe("OpenAiTranslator.getAudio", () => {
  integrationTest("returns an audio blob from the realtime websocket", async () => {
    const translator = OpenAiTranslator()
    const audio = await translator.getAudio("hello", "French")

    expect(audio).toBeInstanceOf(Blob)
    expect(audio.type).toBe("audio/wav")
    expect(audio.size).toBeGreaterThan(0)
  })

  integrationTest("supports multiple audio requests on one translator instance", async () => {
    const translator = OpenAiTranslator()
    const firstAudio = await translator.getAudio("hello", "French")
    const secondAudio = await translator.getAudio("hello again", "French")

    expect(firstAudio).toBeInstanceOf(Blob)
    expect(firstAudio.type).toBe("audio/wav")
    expect(firstAudio.size).toBeGreaterThan(0)

    expect(secondAudio).toBeInstanceOf(Blob)
    expect(secondAudio.type).toBe("audio/wav")
    expect(secondAudio.size).toBeGreaterThan(0)
  })
})

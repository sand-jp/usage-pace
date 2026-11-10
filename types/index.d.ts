/** `model`: the model of a per-model weekly window (`seven_day_model`), e.g. "Fable". */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string; model?: string }

/** The per-model weekly windows the usage endpoint last answered, and when it was asked (epoch ms). */
export type Scoped = { at: number; limits: Limit[] }

/** The live context window: `tokens` absent before the first response of the chat. */
export type Context = { tokens?: number; window: number; percent?: number }

/** Which parts are shown: the usage meters, the context meter, the status line; `tiny` packs the status line; `clock` adds the reset time to the meter headings; `model` adds the per-model weekly windows (Fable). */
export type Parts = { pace: boolean; context: boolean; line: boolean; tiny: boolean; clock: boolean; model: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': {
      limits: Shaped<Limit[]>
      /** true while `limits` is the last reading saved by any chat, not one of this chat. */
      stale: boolean
      /** The per-model weekly windows (Fable), from the usage endpoint. */
      scoped: Shaped<Limit[]>
      context: Shaped<Context>
      parts: Shaped<Parts>
      tick: number
    }
  }
}

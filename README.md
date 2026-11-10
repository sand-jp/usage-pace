# usage-pace

[日本語](README.ja.md)

A Claude Code mod that shows your plan's usage limits (5-hour, weekly, and the per-model weekly limit such as Max's Fable-only one) as meters, with the elapsed time and a pace projection.

![The usage-pace pane (Japanese)](docs/pane.png)

An English display is also available.

## What it shows
Four parts, each of which can be turned on or off.

**Usage pace (`pace`, in the pane)**
- The share used (whole percent) and the time left until the reset
- The reset time in local time beside each window's name: `5-hour (14:30) 7%`, `Weekly (Sat 9:00) 45%` (`clock`, on by default)
- `▼xx.x% elapsed` above the meter: how much of the window's time has passed (where usage would be at an even pace)
- `▲xx.x% projected` below the meter: the share used at the reset if the current pace goes on (at the right end when over 100%)
- When the projection is over 100%: "Reaches 100% xxh before the reset" (xxm for the 5-hour window)
- Each label sits on whichever side of its marker has room

**Per-model weekly (`model`, in the pane and the line, on by default)**
- The weekly limit of one model alone, such as Max's Fable-only limit, as a meter like the others: `Fable (Wed 12:00) 21%`
- In the line under the prompt it is `[F]` (the model's first letter)
- Claude Code does not hand this window to mods, so the mod asks the usage endpoint (`https://api.anthropic.com/api/oauth/usage`) itself, with the session's credential held by Claude Code (the mod never sees it): when a chat starts, and after a reply, at most once every 5 minutes, shared by every chat. Without a claude.ai sign-in (API key, Bedrock, Vertex, a gateway) nothing is asked and the gauge is not shown. `/usage-pace model off` stops the requests

**Context (`context`, in the pane)**
- `Context 42% used  84.2k / 200k` and a meter
- Yellow from 50%, orange from 70%, red from 85%
- The `compact` button below makes the same summary as `/compact` (after the reply, if one is in progress)

**The line under the prompt (`line`)**
- `[S] 32% 2h55m e: 76.8% , [W] 34% 5d19h e: 200.9% (-84h) , [F] 21% 15h e: 22.1% , [C] 42%`
- S is the 5-hour window, W the weekly one, F the Fable-only weekly one, C the context. `e` is the projection at the reset; the bracket says how many hours (minutes for the 5-hour window) before the reset the pace reaches 100%
- `/usage-pace line tiny` packs it: `[S]32%,2h55m,e:76.8%[W]34%,5d19h,e:200.9%(-84h)[C]42%` (without the "last reading" tag). `line on` brings back the full line

The figures update when a reply from Claude arrives: the mod uses what Claude Code already receives; only the per-model weekly gauge makes a request of its own (see above). Only the elapsed share moves on its own, once a minute.

In a new chat, until its first reply, the mod shows the last usage any chat received, marked as the last reading. A window whose reset time has passed is left out. The context belongs to each chat, so it appears after the first reply.

## Language
Japanese and English. The mod follows Claude Code's `language` setting, or the system's language when that is not set; anything other than Japanese is shown in English.

## Usage
- `/usage-pace`: open or close the pane
- `/usage-pace <part> [on|off]`: show or hide a part; without on/off it flips
  - parts: `pace` (usage pace), `context` (context), `line` (the line under the prompt), `clock` (the reset time in the pane), `model` (the per-model weekly gauge), `all`
  - `line` also takes `tiny` (the packed line)
  - e.g. `/usage-pace line off`, `/usage-pace all on`
- `/usage-pace status`: the current settings

The settings are shared by every chat and apply to the next chat you open. With both `pace` and `context` off, the pane does not open.

## Install
In Claude Code in a terminal:

```
/plugin install usage-pace --marketplace sand-jp/usage-pace
```

In the desktop app: + beside the prompt → Plugins → Add marketplace, enter `sand-jp/usage-pace` → Add plugin.

## License
0BSD. You are free to use, read, modify, improve and redistribute this, with no need to keep any notice.

## Use of AI
This mod was made with AI (Claude Code). Most of the code and text was written by the AI, then reviewed and adjusted by the author.

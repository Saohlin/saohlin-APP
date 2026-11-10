// What to search for, and how much to fetch, for one turn.
import { retrievalSizes, phase2Sizes, MODES, type Mode } from "./modes.ts";

/**
 * The retrieval query: the current message, the previous user turn and what
 * the planner says is still unknown. The Python searched on the last message
 * alone, so turn three of a conversation searched on „a proč?“ (PROJECT_STATUS
 * A4). Fixed before Claudia tests, as the spec requires.
 */
export function retrievalQuery(userMsg: string, previousUserText?: string | null, chybi?: string | null): string {
  return [userMsg, previousUserText, chybi].filter((s) => s && s.trim()).join("\n");
}

/**
 * The largest budget of any mode, fetched once while the planner decides;
 * the chosen mode then trims it (prompt.ts slices each pool).
 */
export function maxLimits(): { knowledge: number; video: number; guide: number; realclient: number } {
  const modes = Object.keys(MODES) as Mode[];
  const r = modes.map((m) => retrievalSizes({ mode: m }));
  const p = modes.map((m) => phase2Sizes({ mode: m }));
  return {
    knowledge: Math.max(...r.map((x) => x[0])),
    video: Math.max(...r.map((x) => x[2])),
    guide: Math.max(...p.map((x) => x[0])),
    realclient: Math.max(...p.map((x) => x[1])),
  };
}

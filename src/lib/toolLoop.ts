// Provider-neutral tool-use loop shared by the editing agent and the producer.
import { activeModel } from "../store/settings";
import type { Message, Part, ToolDef } from "./ipc";
import { ipc } from "./ipc";

export type ToolArgs = Record<string, unknown>;

export interface LoopOptions {
  system: string;
  history: Message[];
  tools: ToolDef[];
  exec(name: string, input: ToolArgs): Promise<unknown>;
  maxSteps?: number;
  signal?: { cancelled: boolean };
  /** Checked after each round of tool calls; true ends the loop. */
  done?(): boolean;
  onText?(delta: string): void;
  onMessage?(m: Message): void;
  onTool?(name: string, input: ToolArgs, result: string, isError: boolean): void;
}

/** Runs until the model stops calling tools. `history` is extended in place. */
export async function runToolLoop(o: LoopOptions): Promise<string> {
  for (let step = 0; step < (o.maxSteps ?? 12); step++) {
    if (o.signal?.cancelled) return "cancelled";
    const res = await ipc.chat({ ...activeModel(), system: o.system, messages: o.history, tools: o.tools }, o.onText);
    o.history.push(res.message);
    o.onMessage?.(res.message);
    if (res.stopReason === "refusal") return "refusal";
    // Never run tools from a truncated turn: inputs may be incomplete.
    if (res.stopReason === "max_tokens") return "max_tokens";
    const calls = res.message.content.filter((p): p is Extract<Part, { type: "toolCall" }> => p.type === "toolCall");
    if (calls.length === 0) return res.stopReason;
    const results: Part[] = [];
    for (const call of calls) {
      let content: string;
      let isError = false;
      try {
        if ("__invalid_json" in call.input) throw new Error("tool arguments were not valid JSON; send them again");
        const out = await o.exec(call.name, call.input);
        content = typeof out === "string" ? out : JSON.stringify(out);
      } catch (e) {
        content = e instanceof Error ? e.message : String(e);
        isError = true;
      }
      o.onTool?.(call.name, call.input, content, isError);
      results.push({ type: "toolResult", id: call.id, name: call.name, content, isError });
    }
    const turn: Message = { role: "user", content: results };
    o.history.push(turn);
    o.onMessage?.(turn);
    if (o.done?.()) return "done";
  }
  return "max_steps";
}

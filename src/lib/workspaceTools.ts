// Read-only access to the product's project folder (the workspace), shared by
// the storyboard research, the revise chat and scene edits.
import type { ToolDef } from "./ipc";
import { ipc } from "./ipc";
import type { ToolArgs } from "./toolLoop";

const str = { type: "string" };

export const WORKSPACE_TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "Lists files and folders (folders end with /) in the product's project folder. Dependency and build folders are skipped.",
    parameters: { type: "object", properties: { dir: { ...str, description: "Folder relative to the project root; empty for root" }, depth: { type: "number" } }, required: ["dir"] },
  },
  {
    name: "read_file",
    description: "Reads a text file from the project folder (first 60 KB).",
    parameters: { type: "object", properties: { path: str }, required: ["path"] },
  },
  {
    name: "search_code",
    description: "Case-insensitive text search across the project folder. Returns path:line: text matches.",
    parameters: { type: "object", properties: { query: str }, required: ["query"] },
  },
  {
    name: "find_images",
    description: "Lists image files in the project folder whose path contains all the given words (e.g. a person's name). Empty query lists all images.",
    parameters: { type: "object", properties: { query: str } },
  },
];

const NAMES = new Set(WORKSPACE_TOOLS.map((t) => t.name));

export const isWorkspaceTool = (name: string) => NAMES.has(name);

/** Runs one of WORKSPACE_TOOLS against workspace `ws`. */
export async function execWorkspaceTool(ws: string | null | undefined, name: string, a: ToolArgs): Promise<string | string[]> {
  if (!ws) throw new Error("this video project has no project folder");
  switch (name) {
    case "list_files":
      return (await ipc.wsListFiles(ws, String(a.dir ?? ""), typeof a.depth === "number" ? a.depth : 2)).join("\n");
    case "read_file":
      return ipc.wsReadFile(ws, String(a.path));
    case "search_code": {
      const hits = await ipc.wsSearch(ws, String(a.query));
      return hits.length ? hits.join("\n") : "No results.";
    }
    case "find_images": {
      const found = await ipc.wsImages(ws, typeof a.query === "string" ? a.query : "");
      return found.length ? found : "No matching images. Try fewer or different words, or an empty query to list all images.";
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

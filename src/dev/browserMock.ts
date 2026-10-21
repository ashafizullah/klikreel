// Dev-only: lets the UI run in a plain browser (vite dev server) with fake
// IPC so layout and interactions can be exercised without the Tauri shell.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const ROOT = import.meta.env.VITE_DEV_MEDIA as string | undefined;
const workspaces = [{ id: "ws_demo", name: "invoicely-saas", path: "/Users/dev/Projects/invoicely-saas", createdAt: Date.now() }];
const projects = new Map<string, string>();
let chatCalls = 0;

const sceneHtml = (title: string, hue: number) => `<!doctype html><html><head><style>
html,body{margin:0;width:100vw;height:100vh;overflow:hidden;font-family:Inter,Helvetica,Arial,sans-serif;background:hsl(${hue} 60% 12%);color:#fff}
.c{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:3vh}
h1{margin:0;font-size:8vh}.bar{width:30vw;height:1vh;background:hsl(${hue} 80% 60%);border-radius:1vh}</style></head>
<body><div class="c"><h1 id="t">${title}</h1><div class="bar" id="b"></div></div><script>
const tl=gsap.timeline({paused:true});tl.from("#t",{y:80,opacity:0,duration:.8}).from("#b",{scaleX:0,duration:.6},"-=.3");
window.__seek=(t)=>tl.seek(t,false);</script></body></html>`;

mockWindows("main");

mockIPC(async (cmd, args) => {
  const a = (args ?? {}) as Record<string, any>;
  const req = a.request ?? {};
  switch (cmd) {
    case "api_keys_status":
      return Object.fromEntries((a.profileIds ?? []).map((id: string) => [id, true]));
    case "system_status":
      return { ffmpeg: "(mock)", ffprobe: "(mock)", chrome: "(mock)", os: "macos", ffmpegInstall: "brew install ffmpeg", chromeInstall: "brew install --cask google-chrome" };
    case "workspaces_list":
      return workspaces;
    case "workspace_add":
      return workspaces[0];
    case "projects_list":
      return [...projects.values()].map((j) => JSON.parse(j)).map((p) => ({ id: p.id, name: p.name, workspaceId: p.workspaceId, width: p.width, height: p.height, scenes: p.scenes.length, updatedAt: Date.now(), size: JSON.stringify(p).length, thumb: null }));
    case "project_store":
      projects.set(a.id, a.json);
      return null;
    case "project_fetch":
      return projects.get(a.id);
    case "project_media":
      return [{ path: `${ROOT}/voice.mp3`, name: "voice.mp3", size: 52000, modified: Date.now() }, { path: `${ROOT}/old_take.mp3`, name: "old_take.mp3", size: 48000, modified: Date.now() - 60000 }];
    case "file_sizes":
      return (a.paths as string[]).map(() => 3_400_000);
    case "project_media_delete":
      return null;
    case "project_delete":
      projects.delete(a.id);
      return null;
    case "ws_overview":
      return "Workspace: invoicely-saas\nsrc/\nREADME.md";
    case "ws_list_files":
      return ["src/", "src/features/invoice/", "README.md"];
    case "ws_read_file":
      return "# Invoicely\nKirim invoice otomatis via WhatsApp.";
    case "ws_search":
      return ["src/features/invoice/send.ts:12: export async function sendInvoiceWhatsapp()"];
    case "ws_image":
      return "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="55" fill="#22d3c5"/></svg>');
    case "ai_chat": {
      chatCalls++;
      await new Promise((r) => setTimeout(r, 300));
      if (req.tools?.some((t: any) => t.name === "submit_storyboard")) {
        if (chatCalls % 2 === 1)
          return { stopReason: "tool_use", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "search_code", input: { query: "invoice" } }] } };
        return {
          stopReason: "tool_use",
          message: {
            role: "assistant",
            content: [{
              type: "toolCall", id: "c2", name: "submit_storyboard",
              input: {
                product_name: "Invoicely", tagline: "Invoice beres sekali klik", summary: "SaaS invoice untuk UMKM.",
                style: { palette: ["#0b1020", "#22d3c5", "#7c5cff"], font_family: "Inter, Helvetica, Arial, sans-serif", mood: "energik", notes: "kartu membulat" },
                logo_path: "public/logo.svg",
                scenes: [
                  { title: "Capek nagih manual?", narration: "Masih nagih pelanggan satu per satu?", visual: "Hook", duration: 3 },
                  { title: "Kirim via WhatsApp", narration: "Invoicely kirim invoice langsung ke WhatsApp.", visual: "Mockup", duration: 4 },
                  { title: "Coba gratis", narration: "Coba gratis empat belas hari.", visual: "CTA", duration: 3 },
                ],
              },
            }],
          },
        };
      }
      return { stopReason: "end_turn", message: { role: "assistant", content: [{ type: "text", text: "OK (mock)" }] } };
    }
    case "ai_generate_frame": {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
      const title = /## This scene: (.*)/.exec(req.context ?? "")?.[1] ?? "Scene";
      return sceneHtml(title, Math.floor(Math.random() * 360));
    }
    case "tts_voices":
      return [{ id: "eve", name: "Eve" }, { id: "ara", name: "Ara" }, { id: "rex", name: "Rex" }, { id: "my_brand_voice", name: "Brand Voice" }];
    case "tts_preview":
    case "tts_generate":
      await new Promise((r) => setTimeout(r, 300));
      return `${ROOT}/voice.mp3`;
    case "media_probe":
      return String(a.path).endsWith(".mp3")
        ? { path: a.path, name: "voice.mp3", kind: "audio", duration: 3.2, width: 0, height: 0, fps: 0, hasAudio: true }
        : { path: a.path, name: String(a.path).split("/").pop(), kind: "video", duration: 10, width: 1280, height: 720, fps: 30, hasAudio: true };
    case "media_retempo":
      return a.path;
    case "media_bytes":
      return await (await fetch(`/@fs${a.path}`)).arrayBuffer();
    case "media_thumbnails":
      return [];
    case "media_waveform":
      return Array.from({ length: Number(a.buckets) }, (_, i) => 0.3 + 0.3 * Math.abs(Math.sin(i / 20)));
    case "plugin:dialog|open":
      return `${ROOT}/voice.mp3`;
    case "plugin:dialog|ask":
      return true;
    case "plugin:event|listen":
      return 1;
    case "plugin:event|unlisten":
      return null;
    case "mcp_start":
      return { url: "http://127.0.0.1:47821/mcp", token: "mock-token" };
    case "mcp_link":
      return { running: true, connected: true, client: "claude-code (mock)", idleSecs: 3 };
    case "mcp_stop":
    case "mcp_reply":
      return null;
    case "terminal_open":
      return "term_mock";
    case "terminal_write":
    case "terminal_resize":
    case "terminal_close":
      return null;
    default:
      throw new Error(`${cmd} tidak tersedia di mode browser`);
  }
});

(window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = (p) => `/@fs${p}`;

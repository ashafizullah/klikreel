// Bundle Monaco locally (no CDN) so the editor works offline inside Tauri.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "html") return new HtmlWorker();
    if (label === "css") return new CssWorker();
    if (label === "javascript" || label === "typescript") return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

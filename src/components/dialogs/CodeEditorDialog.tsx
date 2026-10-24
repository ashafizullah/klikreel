import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import "../../lib/monaco";
import { useProject } from "../../store/project";
import { useUi } from "../../store/ui";
import { findClip } from "../../lib/timeline";
import { buildFrameDoc } from "../../lib/frameRuntime";
import { resolveAssets } from "../../store/images";
import { Button, Modal } from "../ui";
import { useT } from "../../i18n";

export default function CodeEditorDialog() {
  const t = useT();
  const selectedId = useProject((s) => s.selectedClipId);
  const project = useProject((s) => s.project);
  const hit = selectedId ? findClip(project, selectedId) : null;
  const src = hit?.clip.source.type === "html" ? hit.clip.source : null;
  const [code, setCode] = useState(src?.html ?? "");
  const [previewT, setPreviewT] = useState(0);
  const close = () => useUi.getState().open(null);
  const doc = useMemo(() => (src ? buildFrameDoc(code, src.params, resolveAssets(src.assetRefs)) : ""), [code, src]);

  if (!hit || !src) {
    return (
      <Modal title={t("code.editor")} onClose={close}>
        <p className="text-[12px] text-muted">{t("code.pickFirst")}</p>
      </Modal>
    );
  }

  const apply = () => {
    useProject.getState().updateClip(hit.clip.id, { source: { ...src, html: code } });
    close();
  };

  return (
    <Modal title={t("code.title", { name: hit.clip.name })} onClose={close} width={1200}>
      <div className="grid h-[68vh] grid-cols-[1fr_420px] gap-3">
        <div className="overflow-hidden rounded-lg border border-line">
          <Editor
            height="100%"
            defaultLanguage="html"
            theme="vs-dark"
            value={code}
            onChange={(v) => setCode(v ?? "")}
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", tabSize: 2, scrollBeyondLastLine: false }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="checker relative overflow-hidden rounded-lg border border-line" style={{ aspectRatio: `${project.width} / ${project.height}`, maxHeight: "50vh" }}>
            <iframe
              key={doc}
              title="preview"
              sandbox="allow-scripts"
              srcDoc={doc}
              className="absolute top-0 left-0 origin-top-left border-0"
              style={{ width: project.width, height: project.height, transform: `scale(${420 / project.width})` }}
              onLoad={(e) => e.currentTarget.contentWindow?.postMessage({ type: "klikreel:seek", t: previewT }, "*")}
              ref={(el) => el?.contentWindow?.postMessage({ type: "klikreel:seek", t: previewT }, "*")}
            />
          </div>
          <label className="block">
            <span className="label">{t("code.previewAt", { t: previewT.toFixed(2) })}</span>
            <input type="range" className="w-full accent-[var(--color-accent)]" min={0} max={hit.clip.duration} step={0.01} value={previewT} onChange={(e) => setPreviewT(+e.target.value)} />
          </label>
          <p className="text-[11px] leading-relaxed text-muted">
            {t("code.contract")}
          </p>
          <div className="mt-auto flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={apply}>{t("code.apply")}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { FolderPlus, Folder, KeyRound, Plus, Trash2, Film } from "lucide-react";
import { useApp } from "../../store/app";
import { notifyError, useUi } from "../../store/ui";
import { ipc } from "../../lib/ipc";
import { createProject, openProject } from "../../lib/library";
import { formatMB } from "../../lib/time";
import { Button, Modal } from "../ui";
import { LanguageToggle } from "../ui/LanguageToggle";
import { useLocale, useT, type Key } from "../../i18n";
import logo from "../../assets/logo.png";

const FORMATS: { id: string; label: string; hint: Key; w: number; h: number }[] = [
  { id: "16:9", label: "16:9", hint: "home.format169", w: 1920, h: 1080 },
  { id: "9:16", label: "9:16", hint: "home.format916", w: 1080, h: 1920 },
  { id: "1:1", label: "1:1", hint: "home.format11", w: 1080, h: 1080 },
];

export function Home() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const { workspaces, workspaceId, projects, refresh, selectWorkspace } = useApp();
  const [creating, setCreating] = useState(false);
  const ws = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => void refresh().catch(notifyError), []);

  const addWorkspace = async () => {
    try {
      const path = await open({ directory: true, multiple: false, title: t("home.pickFolderTitle") });
      if (!path || Array.isArray(path)) return;
      const created = await ipc.workspaceAdd(path);
      await refresh();
      await selectWorkspace(created.id);
    } catch (e) {
      notifyError(e);
    }
  };

  const removeWorkspace = async () => {
    if (!ws) return;
    const ok = await ask(t("home.removeWorkspaceConfirm", { name: ws.name, path: ws.path }), { title: t("home.removeWorkspaceHeading"), kind: "warning" });
    if (!ok) return;
    await ipc.workspaceRemove(ws.id).catch(notifyError);
    await refresh();
  };

  const removeProject = async (id: string, name: string) => {
    if (!(await ask(t("home.deleteProjectConfirm", { name }), { title: t("home.deleteProject"), kind: "warning" }))) return;
    await ipc.projectDelete(id).catch(notifyError);
    if (workspaceId) await selectWorkspace(workspaceId);
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4" data-tauri-drag-region>
          <img src={logo} alt="" className="h-8 w-8" draggable={false} />
          <span className="text-[13px] font-semibold">KlikReel</span>
        </div>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="label mb-0">{t("home.workspaces")}</span>
          <button className="text-muted hover:text-accent" title={t("home.addWorkspace")} onClick={addWorkspace}>
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => selectWorkspace(w.id)}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left ${w.id === workspaceId ? "bg-panel-2" : "hover:bg-panel-2/60"}`}
            >
              <Folder size={14} className={`mt-0.5 shrink-0 ${w.id === workspaceId ? "text-accent" : "text-muted"}`} />
              <span className="min-w-0">
                <span className="block truncate text-[12px]">{w.name}</span>
                <span className="block truncate text-[10px] text-muted" title={w.path}>{w.path}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line p-3">
          <Button variant="ghost" className="flex-1 justify-start" onClick={() => useUi.getState().open("settings")}>
            <KeyRound size={14} /> {t("home.aiSettings")}
          </Button>
          <LanguageToggle />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {!ws ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <FolderPlus size={40} className="text-accent" />
            <div>
              <h1 className="text-[18px] font-semibold">{t("home.emptyTitle")}</h1>
              <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">
                {t("home.emptyBody")}
              </p>
            </div>
            <Button variant="primary" onClick={addWorkspace}><FolderPlus size={14} /> {t("home.pickFolder")}</Button>
          </div>
        ) : (
          <>
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6" data-tauri-drag-region>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold">{ws.name}</h1>
                <p className="truncate text-[11px] text-muted">{ws.path}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={removeWorkspace} title={t("home.removeWorkspaceTitle")}><Trash2 size={13} /></Button>
                <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> {t("home.newProject")}</Button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-6">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-20 text-center text-[12px] text-muted">
                  <Film size={32} />
                  {t("home.noProjects")}
                  <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> {t("home.firstProject")}</Button>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {projects.map((p) => (
                    <div key={p.id} className="group relative cursor-pointer overflow-hidden rounded-xl border border-line bg-panel hover:border-accent" onClick={() => openProject(p.id)}>
                      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-[#241c4d] to-[#0f2a2a]">
                        <div className="rounded border border-white/30" style={{ width: (p.width / Math.max(p.width, p.height)) * 64, height: (p.height / Math.max(p.width, p.height)) * 64 }} />
                      </div>
                      <div className="p-3">
                        <div className="truncate text-[13px] font-medium">{p.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {t("home.projectMeta", {
                            w: p.width,
                            h: p.height,
                            n: p.scenes,
                            size: formatMB(p.size),
                            date: new Date(p.updatedAt).toLocaleDateString(locale === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                          })}
                        </div>
                      </div>
                      <button
                        className="absolute top-2 right-2 hidden rounded-md bg-black/60 p-1.5 text-muted group-hover:block hover:text-danger"
                        title={t("home.deleteProject")}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProject(p.id, p.name);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
      {creating && ws && <NewProjectDialog workspaceId={ws.id} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProjectDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [format, setFormat] = useState("16:9");
  const create = async () => {
    const f = FORMATS.find((x) => x.id === format)!;
    try {
      await createProject(workspaceId, name.trim() || t("home.defaultProjectName"), f.w, f.h);
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal title={t("home.newProjectTitle")} onClose={onClose} width={460}>
      <div className="space-y-4">
        <label className="block">
          <span className="label">{t("home.projectName")}</span>
          <input autoFocus className="field" placeholder={t("home.projectNamePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        </label>
        <div>
          <span className="label">{t("home.format")}</span>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button key={f.id} onClick={() => setFormat(f.id)} className={`flex flex-col items-center gap-2 rounded-lg border p-3 ${format === f.id ? "border-accent bg-accent/10" : "border-line hover:border-muted"}`}>
                <div className="rounded-sm border border-current" style={{ width: (f.w / Math.max(f.w, f.h)) * 40, height: (f.h / Math.max(f.w, f.h)) * 40 }} />
                <span className="text-[12px] font-semibold">{f.label}</span>
                <span className="text-center text-[10px] text-muted">{t(f.hint)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={create}>{t("home.createProject")}</Button>
        </div>
      </div>
    </Modal>
  );
}

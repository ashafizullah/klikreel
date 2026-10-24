import { useCallback, useEffect, useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, FolderPlus, Folder, FolderOpen, KeyRound, Pencil, Plus, RefreshCw, Trash2, Film, ExternalLink, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate, useUpdate } from "../../lib/updater";
import { useApp } from "../../store/app";
import { notifyError, useUi } from "../../store/ui";
import { ipc, type ProjectMeta, type Workspace } from "../../lib/ipc";
import { createProject, openProject } from "../../lib/library";
import { formatMB } from "../../lib/time";
import { Button, Modal } from "../ui";
import { LanguageToggle } from "../ui/LanguageToggle";
import { useLocale, useT, type Key } from "../../i18n";
import logo from "../../assets/logo.png";
import { ProjectThumb } from "./ProjectThumb";
import { ContextMenu, type MenuState } from "../ui/ContextMenu";

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
  const [menu, setMenu] = useState<MenuState>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [renaming, setRenaming] = useState<{ kind: "workspace" | "project"; id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ws = workspaces.find((w) => w.id === workspaceId);
  const [version, setVersion] = useState("");
  const checkingUpdate = useUpdate((s) => s.checking);
  useEffect(() => void getVersion().then(setVersion).catch(() => {}), []);

  const manualUpdateCheck = async () => {
    try {
      const update = await checkForUpdate();
      if (!update) useUi.getState().notify(t("update.upToDate", { version }));
    } catch (e) {
      useUi.getState().notify(`${t("update.failed")}\n${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  // Selection belongs to one workspace's list.
  useEffect(() => setSelected(new Set()), [workspaceId]);
  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(new Set());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = async (ids: string[]) => {
    if (!ids.length) return;
    if (!(await ask(t("home.deleteSelectedConfirm", { n: ids.length }), { title: t("home.deleteSelected", { n: ids.length }), kind: "warning" }))) return;
    for (const id of ids) await ipc.projectDelete(id).catch(notifyError);
    setSelected(new Set());
    await refresh();
  };

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

  const removeWorkspace = async (w: Workspace | undefined = ws) => {
    if (!w) return;
    const ok = await ask(t("home.removeWorkspaceConfirm", { name: w.name, path: w.path }), { title: t("home.removeWorkspaceHeading"), kind: "warning" });
    if (!ok) return;
    await ipc.workspaceRemove(w.id).catch(notifyError);
    await refresh();
  };

  const rename = async (name: string) => {
    if (!renaming || !name.trim() || name.trim() === renaming.name) return setRenaming(null);
    try {
      if (renaming.kind === "workspace") {
        await ipc.workspaceRename(renaming.id, name.trim());
        await refresh();
      } else {
        const stored = JSON.parse(await ipc.projectFetch(renaming.id));
        stored.name = name.trim();
        await ipc.projectStore(renaming.id, JSON.stringify(stored));
        await refresh();
      }
      setRenaming(null);
    } catch (e) {
      notifyError(e);
    }
  };

  const workspaceMenu = (e: React.MouseEvent, w: Workspace) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      title: w.path,
      items: [
        { icon: FolderOpen, label: t("home.menuOpen"), run: () => selectWorkspace(w.id) },
        { icon: Plus, label: t("home.newProject"), run: () => selectWorkspace(w.id).then(() => setCreating(true)) },
        { icon: Pencil, label: t("home.menuRename"), run: () => setRenaming({ kind: "workspace", id: w.id, name: w.name }) },
        { icon: ExternalLink, label: t("menu.reveal"), run: () => void revealItemInDir(w.path).catch(notifyError) },
        "sep",
        { icon: Trash2, label: t("home.removeWorkspaceTitle"), danger: true, run: () => removeWorkspace(w) },
      ],
    });
  };

  const projectMenu = (e: React.MouseEvent, p: ProjectMeta) => {
    e.preventDefault();
    if (selected.size > 1 && selected.has(p.id)) {
      const ids = [...selected];
      return setMenu({
        x: e.clientX,
        y: e.clientY,
        title: t("home.selectedCount", { n: ids.length }),
        items: [
          { icon: X, label: t("home.clearSelection"), run: () => setSelected(new Set()) },
          "sep",
          { icon: Trash2, label: t("home.deleteSelected", { n: ids.length }), danger: true, run: () => removeSelected(ids) },
        ],
      });
    }
    setMenu({
      x: e.clientX,
      y: e.clientY,
      title: p.name,
      items: [
        { icon: FolderOpen, label: t("home.menuOpen"), run: () => openProject(p.id) },
        { icon: Pencil, label: t("home.menuRename"), run: () => setRenaming({ kind: "project", id: p.id, name: p.name }) },
        { icon: Check, label: t(selected.has(p.id) ? "home.deselect" : "home.select"), run: () => toggleSelect(p.id) },
        "sep",
        { icon: Trash2, label: t("home.deleteProject"), danger: true, run: () => removeProject(p.id, p.name) },
      ],
    });
  };

  const removeProject = async (id: string, name: string) => {
    if (!(await ask(t("home.deleteProjectConfirm", { name }), { title: t("home.deleteProject"), kind: "warning" }))) return;
    await ipc.projectDelete(id).catch(notifyError);
    await refresh();
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-14 items-center gap-2 border-b border-line px-4" data-tauri-drag-region>
          <img src={logo} alt="" className="h-8 w-8" draggable={false} />
          <span className="font-serif text-[18px] font-medium tracking-[-0.02em]">Klik<span className="text-accent italic">Reel</span></span>
        </div>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="label mb-0">{t("home.workspaces")}</span>
          <button className="text-muted transition hover:text-accent" title={t("home.addWorkspace")} onClick={addWorkspace}>
            <FolderPlus size={15} />
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => selectWorkspace(w.id)}
              onContextMenu={(e) => workspaceMenu(e, w)}
              className={`relative flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition ${w.id === workspaceId ? "bg-panel-2 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent" : "hover:bg-panel-2/60"}`}
            >
              <Folder size={14} className={`mt-0.5 shrink-0 ${w.id === workspaceId ? "text-accent" : "text-muted"}`} />
              <span className="min-w-0">
                <span className="block truncate text-[12px]">{w.name}</span>
                <span className="block truncate text-[10px] text-muted" title={w.path}>{w.path}</span>
                <span className="block text-[10px] text-muted">{t("home.workspaceUsage", { n: w.projectCount ?? 0, size: formatMB(w.size ?? 0) })}</span>
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
        <button
          className="flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-muted hover:text-text disabled:opacity-60"
          onClick={manualUpdateCheck}
          disabled={checkingUpdate}
          title={t("update.check")}
        >
          <span>KlikReel {version && `v${version}`}</span>
          <span className="flex items-center gap-1">
            <RefreshCw size={10} className={checkingUpdate ? "animate-spin" : ""} /> {t("update.check")}
          </span>
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {!ws ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <FolderPlus size={40} strokeWidth={1.5} className="text-accent" />
            <div>
              <h1 className="font-serif text-[26px] font-medium tracking-[-0.02em]">{t("home.emptyTitle")}</h1>
              <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">
                {t("home.emptyBody")}
              </p>
            </div>
            <Button variant="primary" onClick={addWorkspace}><FolderPlus size={14} /> {t("home.pickFolder")}</Button>
          </div>
        ) : (
          <>
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-6" data-tauri-drag-region>
              <div className="group/title min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1
                    className="cursor-text truncate font-serif text-[20px] font-medium tracking-[-0.015em]"
                    title={t("home.renameWorkspace")}
                    onDoubleClick={() => setRenaming({ kind: "workspace", id: ws.id, name: ws.name })}
                  >
                    {ws.name}
                  </h1>
                  <button
                    className="text-muted opacity-0 group-hover/title:opacity-100 hover:text-accent"
                    title={t("home.renameWorkspace")}
                    onClick={() => setRenaming({ kind: "workspace", id: ws.id, name: ws.name })}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
                <p className="truncate font-mono text-[10.5px] text-muted">
                  {ws.path} · {t("home.workspaceUsage", { n: ws.projectCount ?? 0, size: formatMB(ws.size ?? 0) })}
                </p>
              </div>
              {selected.size > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-muted">{t("home.selectedCount", { n: selected.size })}</span>
                  <Button variant="ghost" onClick={() => setSelected(selected.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)))}>
                    {t(selected.size === projects.length ? "home.clearSelection" : "home.selectAll")}
                  </Button>
                  <Button variant="danger" onClick={() => removeSelected([...selected])}><Trash2 size={13} /> {t("home.deleteSelected", { n: selected.size })}</Button>
                  <Button variant="ghost" onClick={() => setSelected(new Set())} title={t("home.clearSelection")}><X size={13} /></Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => removeWorkspace()} title={t("home.removeWorkspaceTitle")}><Trash2 size={13} /></Button>
                  <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> {t("home.newProject")}</Button>
                </div>
              )}
            </header>
            <div className="flex-1 overflow-y-auto p-6">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-20 text-center text-[12px] text-muted">
                  <Film size={32} strokeWidth={1.5} className="text-accent/70" />
                  {t("home.noProjects")}
                  <Button variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> {t("home.firstProject")}</Button>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {projects.map((p, i) => (
                    <div
                      key={p.id}
                      style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                      className={`group relative animate-rise cursor-pointer overflow-hidden rounded-lg border bg-panel transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.8)] ${selected.has(p.id) ? "border-accent ring-1 ring-accent" : "border-line hover:border-accent/70"}`}
                      onClick={(e) => (selected.size > 0 || e.metaKey || e.ctrlKey ? toggleSelect(p.id) : openProject(p.id))}
                      onContextMenu={(e) => projectMenu(e, p)}
                    >
                      <div className="sprockets h-2.5 border-b border-line bg-[#120f0b]" />
                      <ProjectThumb project={p} />
                      <button
                        className={`absolute top-4.5 left-2 flex h-5 w-5 items-center justify-center rounded border ${
                          selected.has(p.id) ? "border-accent bg-accent text-ink" : `border-white/60 bg-black/50 text-transparent ${selected.size ? "" : "hidden group-hover:flex"}`
                        }`}
                        title={t(selected.has(p.id) ? "home.deselect" : "home.select")}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelect(p.id);
                        }}
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>
                      <div className="p-3">
                        <div
                          className="truncate text-[13px] font-medium"
                          title={t("home.renameProject")}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenaming({ kind: "project", id: p.id, name: p.name });
                          }}
                        >
                          {p.name}
                        </div>
                        <div className="mt-1 font-mono text-[10.5px] text-muted">
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
                        className={`absolute top-4.5 right-10 hidden rounded-md bg-black/60 p-1.5 text-muted hover:text-accent ${selected.size ? "" : "group-hover:block"}`}
                        title={t("home.renameProject")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming({ kind: "project", id: p.id, name: p.name });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className={`absolute top-4.5 right-2 hidden rounded-md bg-black/60 p-1.5 text-muted hover:text-danger ${selected.size ? "" : "group-hover:block"}`}
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
      {renaming && (
        <RenameDialog
          title={t(renaming.kind === "workspace" ? "home.renameWorkspace" : "home.renameProject")}
          initial={renaming.name}
          onSave={rename}
          onClose={() => setRenaming(null)}
        />
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
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
              <button key={f.id} onClick={() => setFormat(f.id)} className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition ${format === f.id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:border-muted hover:text-text"}`}>
                <div className="rounded-sm border border-current" style={{ width: (f.w / Math.max(f.w, f.h)) * 40, height: (f.h / Math.max(f.w, f.h)) * 40 }} />
                <span className="font-mono text-[12px] font-medium">{f.label}</span>
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

function RenameDialog({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <div className="space-y-4">
        <input
          autoFocus
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => e.key === "Enter" && onSave(name)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onSave(name)}>{t("common.save")}</Button>
        </div>
      </div>
    </Modal>
  );
}

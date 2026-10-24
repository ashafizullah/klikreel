//! App-data storage for workspaces and projects. Nothing is written into the
//! user's workspace folder; projects live under the app data directory.
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub workspace_id: String,
    pub width: u64,
    pub height: u64,
    pub scenes: usize,
    pub updated_at: u64,
    /// Bytes on disk: project file plus generated media.
    pub size: u64,
    /// First generated scene, for the project card preview.
    pub thumb: Option<ProjectThumb>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectThumb {
    pub html: String,
    pub duration: f64,
    /// Image data URIs the scene uses, keyed by asset name.
    pub assets: serde_json::Map<String, Value>,
}

/// Skip images in card previews beyond this many bytes of data URIs.
const THUMB_ASSET_BUDGET: usize = 3 * 1024 * 1024;

fn project_thumb(v: &Value) -> Option<ProjectThumb> {
    let scene = v["scenes"].as_array()?.iter().find(|s| s["html"].as_str().is_some_and(|h| !h.trim().is_empty()))?;
    let mut assets = serde_json::Map::new();
    let mut used = 0;
    for (name, path) in scene["assetRefs"].as_object().into_iter().flatten() {
        let Some(uri) = path.as_str().and_then(|p| v["images"][p].as_str()) else { continue };
        if used + uri.len() > THUMB_ASSET_BUDGET {
            continue;
        }
        used += uri.len();
        assets.insert(name.clone(), Value::String(uri.to_string()));
    }
    Some(ProjectThumb { html: scene["html"].as_str()?.to_string(), duration: scene["duration"].as_f64().unwrap_or(4.0), assets })
}

/// Total size of all files under `dir`.
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

pub struct Library {
    root: PathBuf,
    lock: Mutex<()>,
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn valid_id(id: &str) -> AppResult<&str> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Ok(id)
    } else {
        Err(AppError::msg("Invalid id"))
    }
}

impl Library {
    pub fn new(root: PathBuf) -> Self {
        Self { root, lock: Mutex::new(()) }
    }

    fn workspaces_file(&self) -> PathBuf {
        self.root.join("workspaces.json")
    }

    pub fn project_dir(&self, id: &str) -> AppResult<PathBuf> {
        Ok(self.root.join("projects").join(valid_id(id)?))
    }

    pub fn media_dir(&self, id: &str) -> AppResult<PathBuf> {
        let dir = self.project_dir(id)?.join("media");
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// Files the AI generated for a project (voiceovers and older takes), newest first.
    pub fn media_files(&self, id: &str) -> AppResult<Vec<MediaFile>> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(self.media_dir(id)?)?.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let modified =
                meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            out.push(MediaFile {
                path: e.path().to_string_lossy().into_owned(),
                name: e.file_name().to_string_lossy().into_owned(),
                size: meta.len(),
                modified,
            });
        }
        out.sort_by_key(|f| std::cmp::Reverse(f.modified));
        Ok(out)
    }

    /// Deletes one generated file; only plain names inside the project's media folder are accepted.
    pub fn delete_media(&self, id: &str, name: &str) -> AppResult<()> {
        if name.is_empty() || name.contains(['/', '\\']) || name.starts_with('.') {
            return Err(AppError::msg("Invalid file name"));
        }
        let path = self.media_dir(id)?.join(name);
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn workspaces(&self) -> AppResult<Vec<Workspace>> {
        match std::fs::read_to_string(self.workspaces_file()) {
            Ok(s) => Ok(serde_json::from_str(&s)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    fn write_workspaces(&self, list: &[Workspace]) -> AppResult<()> {
        std::fs::create_dir_all(&self.root)?;
        write_atomic(&self.workspaces_file(), &serde_json::to_string_pretty(list)?)
    }

    pub fn add_workspace(&self, path: &str, name: Option<String>) -> AppResult<Workspace> {
        let _g = self.lock.lock().unwrap();
        let canon = Path::new(path).canonicalize().map_err(|_| AppError::msg("Folder not found"))?;
        if !canon.is_dir() {
            return Err(AppError::msg("Choose a folder"));
        }
        let path = canon.to_string_lossy().into_owned();
        let mut list = self.workspaces()?;
        if let Some(existing) = list.iter().find(|w| w.path == path) {
            return Ok(existing.clone());
        }
        let ws = Workspace {
            id: format!("ws_{}", &uuid::Uuid::new_v4().simple().to_string()[..10]),
            name: name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| canon.file_name().and_then(|n| n.to_str()).unwrap_or("Workspace").to_string()),
            path,
            created_at: now(),
        };
        list.push(ws.clone());
        self.write_workspaces(&list)?;
        Ok(ws)
    }

    pub fn rename_workspace(&self, id: &str, name: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut list = self.workspaces()?;
        let ws = list.iter_mut().find(|w| w.id == id).ok_or_else(|| AppError::msg("Workspace not found"))?;
        ws.name = name.to_string();
        self.write_workspaces(&list)
    }

    /// Unlinks a workspace and deletes its projects (the workspace folder itself is untouched).
    pub fn remove_workspace(&self, id: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        for p in self.projects(Some(id))? {
            let _ = std::fs::remove_dir_all(self.project_dir(&p.id)?);
        }
        let list: Vec<Workspace> = self.workspaces()?.into_iter().filter(|w| w.id != id).collect();
        self.write_workspaces(&list)
    }

    pub fn workspace(&self, id: &str) -> AppResult<Workspace> {
        self.workspaces()?.into_iter().find(|w| w.id == id).ok_or_else(|| AppError::msg("Workspace not found"))
    }

    pub fn projects(&self, workspace_id: Option<&str>) -> AppResult<Vec<ProjectMeta>> {
        let dir = self.root.join("projects");
        let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
        let mut out = Vec::new();
        for e in entries.flatten() {
            let file = e.path().join("project.json");
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
            let ws = v["workspaceId"].as_str().unwrap_or("").to_string();
            if workspace_id.is_some_and(|w| w != ws) {
                continue;
            }
            let updated = file
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(ProjectMeta {
                id: v["id"].as_str().unwrap_or("").to_string(),
                name: v["name"].as_str().unwrap_or("").to_string(),
                workspace_id: ws,
                width: v["width"].as_u64().unwrap_or(0),
                height: v["height"].as_u64().unwrap_or(0),
                scenes: v["scenes"].as_array().map_or(0, |a| a.len()),
                updated_at: updated,
                size: dir_size(&e.path()),
                thumb: project_thumb(&v),
            });
        }
        out.sort_by_key(|p| std::cmp::Reverse(p.updated_at));
        Ok(out)
    }

    pub fn save_project(&self, id: &str, json: &str) -> AppResult<()> {
        let dir = self.project_dir(id)?;
        std::fs::create_dir_all(&dir)?;
        write_atomic(&dir.join("project.json"), json)
    }

    pub fn load_project(&self, id: &str) -> AppResult<String> {
        Ok(std::fs::read_to_string(self.project_dir(id)?.join("project.json"))?)
    }

    pub fn delete_project(&self, id: &str) -> AppResult<()> {
        let dir = self.project_dir(id)?;
        if dir.exists() {
            std::fs::remove_dir_all(dir)?;
        }
        Ok(())
    }
}

fn write_atomic(path: &Path, contents: &str) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_and_project_roundtrip() {
        let root = std::env::temp_dir().join(format!("klikreel-lib-{}", uuid::Uuid::new_v4().simple()));
        let lib = Library::new(root.clone());
        let ws = lib.add_workspace(std::env::temp_dir().to_str().unwrap(), None).unwrap();
        assert_eq!(lib.add_workspace(std::env::temp_dir().to_str().unwrap(), None).unwrap().id, ws.id);
        lib.save_project(
            "prj_1",
            &format!(r#"{{"id":"prj_1","name":"Promo","workspaceId":"{}","width":1080,"height":1920,"scenes":[{{}},{{}}]}}"#, ws.id),
        )
        .unwrap();
        let list = lib.projects(Some(&ws.id)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].scenes, 2);
        assert!(list[0].size > 0);
        assert!(lib.project_dir("../x").is_err());
        let media = lib.media_dir("prj_1").unwrap();
        std::fs::write(media.join("voice_a.mp3"), b"x").unwrap();
        assert_eq!(lib.media_files("prj_1").unwrap()[0].name, "voice_a.mp3");
        assert!(lib.delete_media("prj_1", "../project.json").is_err());
        lib.delete_media("prj_1", "voice_a.mp3").unwrap();
        assert!(lib.media_files("prj_1").unwrap().is_empty());
        lib.remove_workspace(&ws.id).unwrap();
        assert!(lib.projects(None).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}

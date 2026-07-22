const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dataDirectory = path.join(__dirname, "data");
const databaseFilePath = path.join(dataDirectory, "ebs.sqlite");

let database = null;

/**
 * DB 파일을 둘 폴더와 프로젝트 기본 정보 테이블을 준비한다.
 */
function initializeDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });

  database = new DatabaseSync(databaseFilePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL DEFAULT '',
      folder_name TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      topic TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT '',
      style TEXT NOT NULL DEFAULT '',
      scene_count INTEGER NOT NULL DEFAULT 0,
      project_file_path TEXT NOT NULL DEFAULT '',
      script_file_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scene_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL DEFAULT '',
      project_folder_name TEXT NOT NULL,
      scene_index INTEGER NOT NULL,
      result_type TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      error_message TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_folder_name, scene_index, result_type)
    );
  `);

  ensureColumn("projects", "project_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("scene_results", "project_id", "TEXT NOT NULL DEFAULT ''");
  database.exec(`
    UPDATE projects
    SET project_id = folder_name
    WHERE project_id = '';

    UPDATE scene_results
    SET project_id = project_folder_name
    WHERE project_id = '';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_id
    ON projects(project_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_results_project_id_scene_type
    ON scene_results(project_id, scene_index, result_type);
  `);

  return {
    databaseFilePath,
  };
}

/**
 * 기존 DB 파일에 새 컬럼이 없으면 보수적으로 추가한다.
 */
function ensureColumn(tableName, columnName, columnDefinition) {
  const columnRows = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columnRows.some((columnRow) => columnRow.name === columnName);

  if (!hasColumn) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

/**
 * 초기화된 DB 연결을 반환한다.
 */
function getDatabase() {
  if (!database) {
    initializeDatabase();
  }

  return database;
}

/**
 * 프로젝트 기본 정보를 DB에 새로 저장하거나 기존 행을 갱신한다.
 */
function upsertProjectBasicInfo(projectInfo) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const folderName = typeof projectInfo.folderName === "string" ? projectInfo.folderName.trim() : "";
  const projectId = typeof projectInfo.projectId === "string" && projectInfo.projectId.trim()
    ? projectInfo.projectId.trim()
    : folderName;
  const name = typeof projectInfo.name === "string" && projectInfo.name.trim()
    ? projectInfo.name.trim()
    : folderName;

  if (!projectId || !folderName) {
    throw new Error("DB에 저장할 프로젝트 ID와 폴더 이름이 필요합니다.");
  }

  const statement = db.prepare(`
    INSERT INTO projects (
      project_id,
      folder_name,
      name,
      topic,
      tone,
      style,
      scene_count,
      project_file_path,
      script_file_path,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      folder_name = excluded.folder_name,
      name = excluded.name,
      topic = excluded.topic,
      tone = excluded.tone,
      style = excluded.style,
      scene_count = excluded.scene_count,
      project_file_path = excluded.project_file_path,
      script_file_path = excluded.script_file_path,
      updated_at = excluded.updated_at
  `);

  statement.run(
    projectId,
    folderName,
    name,
    typeof projectInfo.topic === "string" ? projectInfo.topic : name,
    typeof projectInfo.tone === "string" ? projectInfo.tone : "",
    typeof projectInfo.style === "string" ? projectInfo.style : "",
    Number.isInteger(projectInfo.sceneCount) ? projectInfo.sceneCount : 0,
    typeof projectInfo.projectFilePath === "string" ? projectInfo.projectFilePath : "",
    typeof projectInfo.scriptFilePath === "string" ? projectInfo.scriptFilePath : "",
    now,
    now
  );
}

/**
 * 이미지와 영상 생성 결과 메타데이터를 새로 저장하거나 기존 행을 갱신한다.
 */
function upsertSceneResult(sceneResult) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const projectFolderName = typeof sceneResult.projectFolderName === "string" ? sceneResult.projectFolderName.trim() : "";
  const projectId = typeof sceneResult.projectId === "string" && sceneResult.projectId.trim()
    ? sceneResult.projectId.trim()
    : projectFolderName;
  const resultType = typeof sceneResult.resultType === "string" ? sceneResult.resultType.trim() : "";
  const sceneIndex = Number.parseInt(String(sceneResult.sceneIndex), 10);

  if (!projectId || !projectFolderName) {
    throw new Error("DB에 저장할 프로젝트 ID와 폴더 이름이 필요합니다.");
  }

  if (Number.isNaN(sceneIndex) || sceneIndex < 0) {
    throw new Error("DB에 저장할 장면 번호가 올바르지 않습니다.");
  }

  if (!["image", "video"].includes(resultType)) {
    throw new Error("DB에 저장할 결과 타입이 올바르지 않습니다.");
  }

  const statement = db.prepare(`
    INSERT INTO scene_results (
      project_id,
      project_folder_name,
      scene_index,
      result_type,
      url,
      status,
      error_message,
      prompt,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, scene_index, result_type) DO UPDATE SET
      project_folder_name = excluded.project_folder_name,
      url = excluded.url,
      status = excluded.status,
      error_message = excluded.error_message,
      prompt = excluded.prompt,
      updated_at = excluded.updated_at
  `);

  statement.run(
    projectId,
    projectFolderName,
    sceneIndex,
    resultType,
    typeof sceneResult.url === "string" ? sceneResult.url : "",
    typeof sceneResult.status === "string" ? sceneResult.status : "idle",
    typeof sceneResult.errorMessage === "string" ? sceneResult.errorMessage : "",
    typeof sceneResult.prompt === "string" ? sceneResult.prompt : "",
    now,
    now
  );
}

/**
 * 프로젝트의 수정일을 현재 시각으로 갱신한다.
 */
function touchProjectUpdatedAt(projectFolderName, projectId) {
  const db = getDatabase();
  const normalizedProjectFolderName = typeof projectFolderName === "string" ? projectFolderName.trim() : "";
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";

  if (!normalizedProjectFolderName && !normalizedProjectId) {
    throw new Error("수정일을 갱신할 프로젝트 ID 또는 폴더 이름이 필요합니다.");
  }

  const statement = db.prepare(`
    UPDATE projects
    SET updated_at = ?
    WHERE project_id = ? OR (? = '' AND folder_name = ?)
  `);

  statement.run(new Date().toISOString(), normalizedProjectId, normalizedProjectId, normalizedProjectFolderName);
}

/**
 * 프로젝트 ID 또는 폴더 이름으로 이미지와 영상 결과 메타데이터를 조회한다.
 */
function listSceneResultsByProject(projectFolderName, projectId) {
  const db = getDatabase();
  const normalizedProjectFolderName = typeof projectFolderName === "string" ? projectFolderName.trim() : "";
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";

  if (!normalizedProjectFolderName && !normalizedProjectId) {
    throw new Error("조회할 프로젝트 ID 또는 폴더 이름이 필요합니다.");
  }

  const statement = db.prepare(`
    SELECT
      project_id AS projectId,
      project_folder_name AS projectFolderName,
      scene_index AS sceneIndex,
      result_type AS resultType,
      url,
      status,
      error_message AS errorMessage,
      prompt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM scene_results
    WHERE project_id = ? OR (? = '' AND project_folder_name = ?)
    ORDER BY scene_index ASC, result_type ASC
  `);

  return statement.all(normalizedProjectId, normalizedProjectId, normalizedProjectFolderName);
}

/**
 * DB에 저장된 프로젝트 목록을 최신 수정 순서로 조회한다.
 */
function listProjects() {
  const db = getDatabase();
  const statement = db.prepare(`
    SELECT
      id,
      project_id AS projectId,
      folder_name AS folderName,
      name,
      topic,
      tone,
      style,
      scene_count AS sceneCount,
      project_file_path AS projectFilePath,
      script_file_path AS scriptFilePath,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM projects
    ORDER BY updated_at DESC, id DESC
  `);

  return statement.all();
}

/**
 * 프로젝트 폴더 이름으로 DB에 저장된 프로젝트 기본 정보를 조회한다.
 */
function getProjectByFolderName(projectFolderName) {
  const db = getDatabase();
  const normalizedProjectFolderName = typeof projectFolderName === "string" ? projectFolderName.trim() : "";

  if (!normalizedProjectFolderName) {
    throw new Error("조회할 프로젝트 폴더 이름이 필요합니다.");
  }

  const statement = db.prepare(`
    SELECT
      id,
      project_id AS projectId,
      folder_name AS folderName,
      name,
      topic,
      tone,
      style,
      scene_count AS sceneCount,
      project_file_path AS projectFilePath,
      script_file_path AS scriptFilePath,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM projects
    WHERE folder_name = ?
  `);

  return statement.get(normalizedProjectFolderName);
}

/**
 * 프로젝트 고유 ID로 DB에 저장된 프로젝트 기본 정보를 조회한다.
 */
function getProjectById(projectId) {
  const db = getDatabase();
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";

  if (!normalizedProjectId) {
    throw new Error("조회할 프로젝트 ID가 필요합니다.");
  }

  const statement = db.prepare(`
    SELECT
      id,
      project_id AS projectId,
      folder_name AS folderName,
      name,
      topic,
      tone,
      style,
      scene_count AS sceneCount,
      project_file_path AS projectFilePath,
      script_file_path AS scriptFilePath,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM projects
    WHERE project_id = ?
  `);

  return statement.get(normalizedProjectId);
}

module.exports = {
  databaseFilePath,
  getProjectById,
  getProjectByFolderName,
  initializeDatabase,
  listSceneResultsByProject,
  listProjects,
  touchProjectUpdatedAt,
  upsertSceneResult,
  upsertProjectBasicInfo,
};

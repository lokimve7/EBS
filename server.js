const http = require("http");
const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const {
  databaseFilePath,
  getProjectById,
  getProjectByFolderName,
  initializeDatabase,
  listSceneResultsByProject,
  listProjects,
  touchProjectUpdatedAt,
  upsertSceneResult,
  upsertProjectBasicInfo,
} = require("./database");

const PORT = 3001;
const HOST = "0.0.0.0";
const publicHost = "localhost";
const publicDirectory = path.join(__dirname, "public");
const indexFilePath = path.join(publicDirectory, "index.html");
const projectsDirectory = path.join(__dirname, "projects");
const openAiApiHost = "api.openai.com";
const openAiResponsesPath = "/v1/responses";
const openAiImagesPath = "/v1/images/generations";
const evolinkApiHost = "api.evolink.ai";
const evolinkVideoGenerationPath = "/v1/videos/generations";
const evolinkTaskPathPrefix = "/v1/tasks/";
const evolinkFilesApiHost = "files-api.evolink.ai";
const evolinkBase64UploadPath = "/api/v1/files/upload/base64";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const rangeRequestFileExtensions = [".mp4", ".webm"];
const supportedDurations = [3, 4, 5];
const projectAssetFolderNames = ["scripts", "images", "videos", "voices"];
const imageOutputFormat = "png";
const evolinkVideoModel = "kling-o3-image-to-video";
const evolinkVideoPollingIntervalMs = 3000;
const evolinkVideoPollingTimeoutMs = 120000;
let scriptRequestSequence = 0;
let imageRequestSequence = 0;
let videoRequestSequence = 0;

/**
 * 서버 터미널 확인용 로그를 공통 형식으로 출력한다.
 */
function logServerEvent(label, details) {
  const timestamp = new Date().toISOString();

  if (details) {
    console.log(`[${timestamp}] ${label}`, details);
    return;
  }

  console.log(`[${timestamp}] ${label}`);
}

/**
 * 기본 환영 페이지를 응답한다.
 */
function serveWelcomePage(response) {
  fs.readFile(indexFilePath, "utf8", (error, fileContent) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("페이지를 불러오지 못했습니다.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    response.end(fileContent);
  });
}

/**
 * 영상 파일의 Range 요청에 맞춰 일부 구간만 응답한다.
 */
function serveRangeFile(filePath, request, response, contentType, fileSize) {
  const rangeHeader = request.headers.range || "";
  const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!rangeMatch) {
    response.writeHead(416, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Range": `bytes */${fileSize}`,
    });
    response.end("요청한 영상 구간이 올바르지 않습니다.");
    return;
  }

  const requestedStart = rangeMatch[1] ? Number.parseInt(rangeMatch[1], 10) : 0;
  const requestedEnd = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : fileSize - 1;
  const start = Number.isNaN(requestedStart) ? 0 : requestedStart;
  const end = Number.isNaN(requestedEnd) ? fileSize - 1 : Math.min(requestedEnd, fileSize - 1);

  if (start >= fileSize || end >= fileSize || start > end) {
    response.writeHead(416, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Range": `bytes */${fileSize}`,
    });
    response.end("요청한 영상 구간을 찾을 수 없습니다.");
    return;
  }

  response.writeHead(206, {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Content-Length": end - start + 1,
  });
  fs.createReadStream(filePath, { start, end }).pipe(response);
}

/**
 * 정적 파일 경로를 읽어 응답한다.
 */
function serveStaticFile(filePath, request, response) {
  const fileExtension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[fileExtension] || "application/octet-stream";
  const responseHeaders = { "Content-Type": contentType };

  if ([".css", ".html", ".js"].includes(fileExtension)) {
    responseHeaders["Cache-Control"] = "no-cache";
  }

  if (rangeRequestFileExtensions.includes(fileExtension)) {
    fs.stat(filePath, (error, fileStats) => {
      if (error || !fileStats.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("페이지를 찾을 수 없습니다.");
        return;
      }

      if (request.headers.range) {
        serveRangeFile(filePath, request, response, contentType, fileStats.size);
        return;
      }

      response.writeHead(200, {
        ...responseHeaders,
        "Accept-Ranges": "bytes",
        "Content-Length": fileStats.size,
      });
      fs.createReadStream(filePath).pipe(response);
    });
    return;
  }

  fs.readFile(filePath, (error, fileContent) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("페이지를 찾을 수 없습니다.");
      return;
    }

    response.writeHead(200, responseHeaders);
    response.end(fileContent);
  });
}

/**
 * JSON 응답을 반환한다.
 */
function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

/**
 * 프로젝트 폴더 안의 저장 파일 경로인지 확인한 뒤 JSON을 읽는다.
 */
async function readProjectJsonFile(projectFolderName, filePath, fallbackRelativePath) {
  const storagePaths = createProjectStoragePaths(projectFolderName, projectFolderName);
  const fallbackFilePath = fallbackRelativePath
    ? path.join(storagePaths.projectDirectory, fallbackRelativePath)
    : "";
  const normalizedFilePath = typeof filePath === "string" ? filePath.trim() : "";
  const targetFilePath = normalizedFilePath
    ? path.resolve(path.isAbsolute(normalizedFilePath) ? normalizedFilePath : path.join(__dirname, normalizedFilePath))
    : path.resolve(fallbackFilePath);
  const projectDirectoryPath = path.resolve(storagePaths.projectDirectory);
  const projectDirectoryPrefix = projectDirectoryPath.endsWith(path.sep)
    ? projectDirectoryPath
    : `${projectDirectoryPath}${path.sep}`;

  if (targetFilePath !== projectDirectoryPath && !targetFilePath.startsWith(projectDirectoryPrefix)) {
    throw new Error("프로젝트 저장 파일 경로가 올바르지 않습니다.");
  }

  const rawFileText = await fs.promises.readFile(targetFilePath, "utf8");
  return JSON.parse(rawFileText);
}

/**
 * POST 요청 본문을 JSON으로 읽는다.
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const requestChunks = [];

    request.on("data", (chunk) => {
      requestChunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const rawBody = Buffer.concat(requestChunks).toString("utf8");
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch (error) {
        reject(new Error("요청 데이터를 읽지 못했습니다."));
      }
    });

    request.on("error", () => {
      reject(new Error("요청 데이터를 읽는 중 오류가 발생했습니다."));
    });
  });
}

/**
 * 스크립트 생성 요청값이 현재 허용 범위와 맞는지 확인한다.
 */
function validateScriptRequestPayload(requestBody) {
  const topic = typeof requestBody.topic === "string" ? requestBody.topic.trim() : "";
  const tone = typeof requestBody.tone === "string" ? requestBody.tone.trim() : "";
  const style = typeof requestBody.style === "string" ? requestBody.style.trim() : "";
  const openaiApiKey = typeof requestBody.openaiApiKey === "string" ? requestBody.openaiApiKey.trim() : "";
  const sceneCount = Number.parseInt(String(requestBody.sceneCount), 10);

  if (!topic) {
    throw new Error("영상 주제를 먼저 입력해 주세요.");
  }

  if (!tone || !style) {
    throw new Error("분위기와 스타일을 모두 선택해 주세요.");
  }

  if (!openaiApiKey) {
    throw new Error("OpenAI API 키가 필요합니다.");
  }

  if (Number.isNaN(sceneCount) || sceneCount < 3 || sceneCount > 10) {
    throw new Error("장면 수는 3에서 10 사이여야 합니다.");
  }

  return {
    topic,
    tone,
    style,
    sceneCount,
    openaiApiKey,
  };
}

/**
 * 이미지 생성 요청값이 현재 허용 범위와 맞는지 확인한다.
 */
function validateImageRequestPayload(requestBody) {
  const topic = typeof requestBody.topic === "string" ? requestBody.topic.trim() : "";
  const imagePrompt = typeof requestBody.imagePrompt === "string" ? requestBody.imagePrompt.trim() : "";
  const openaiApiKey = typeof requestBody.openaiApiKey === "string" ? requestBody.openaiApiKey.trim() : "";
  const projectFolderName = typeof requestBody.projectFolderName === "string" ? requestBody.projectFolderName.trim() : "";
  const projectId = typeof requestBody.projectId === "string" ? requestBody.projectId.trim() : "";
  const sceneIndex = Number.parseInt(String(requestBody.sceneIndex), 10);

  if (!topic) {
    throw new Error("프로젝트 주제를 확인할 수 없습니다.");
  }

  if (!imagePrompt) {
    throw new Error("이미지 생성용 프롬프트가 필요합니다.");
  }

  if (!openaiApiKey) {
    throw new Error("OpenAI API 키가 필요합니다.");
  }

  if (Number.isNaN(sceneIndex) || sceneIndex < 0) {
    throw new Error("생성할 장면 번호가 올바르지 않습니다.");
  }

  return {
    topic,
    imagePrompt,
    openaiApiKey,
    projectId,
    projectFolderName,
    sceneIndex,
  };
}

/**
 * 영상 생성 요청값이 현재 허용 범위와 맞는지 확인한다.
 */
function validateVideoRequestPayload(requestBody) {
  const topic = typeof requestBody.topic === "string" ? requestBody.topic.trim() : "";
  const videoPrompt = typeof requestBody.videoPrompt === "string" ? requestBody.videoPrompt.trim() : "";
  const klingApiKey = typeof requestBody.klingApiKey === "string" ? requestBody.klingApiKey.trim() : "";
  const projectFolderName = typeof requestBody.projectFolderName === "string" ? requestBody.projectFolderName.trim() : "";
  const projectId = typeof requestBody.projectId === "string" ? requestBody.projectId.trim() : "";
  const sourceImagePath = typeof requestBody.sourceImagePath === "string" ? requestBody.sourceImagePath.trim() : "";
  const sceneIndex = Number.parseInt(String(requestBody.sceneIndex), 10);

  if (!topic) {
    throw new Error("프로젝트 주제를 확인할 수 없습니다.");
  }

  if (!videoPrompt) {
    throw new Error("영상 생성용 프롬프트가 필요합니다.");
  }

  if (!klingApiKey) {
    throw new Error("EvoLink.AI API 키가 필요합니다.");
  }

  if (!projectFolderName && !projectId) {
    throw new Error("프로젝트 정보를 확인할 수 없습니다.");
  }

  if (!sourceImagePath) {
    throw new Error("영상 생성에 사용할 이미지 경로가 필요합니다.");
  }

  if (Number.isNaN(sceneIndex) || sceneIndex < 0) {
    throw new Error("생성할 장면 번호가 올바르지 않습니다.");
  }

  return {
    topic,
    videoPrompt,
    klingApiKey,
    projectId,
    projectFolderName,
    sourceImagePath,
    sceneIndex,
  };
}

/**
 * 프로젝트 폴더 이름으로 사용할 수 있도록 주제를 정리한다.
 */
function sanitizeProjectFolderName(topic) {
  const normalizedTopic = String(topic).normalize("NFC").trim();
  const sanitizedTopic = normalizedTopic
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);

  return sanitizedTopic || "project";
}

/**
 * 새 프로젝트와 결과 파일명에 사용할 짧은 고유 ID를 만든다.
 */
function createProjectId() {
  return `project-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * 파일명에 안전하게 포함할 수 있도록 프로젝트 ID를 정리한다.
 */
function sanitizeProjectId(projectId) {
  const rawProjectId = String(projectId || "").trim();
  if (!rawProjectId) {
    return "";
  }

  const sanitizedProjectId = rawProjectId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  if (sanitizedProjectId) {
    return sanitizedProjectId;
  }

  return `project-${crypto.createHash("sha1").update(rawProjectId).digest("hex").slice(0, 12)}`;
}

/**
 * 프로젝트 저장에 필요한 기본 폴더 구조 경로를 계산한다.
 */
function createProjectStoragePaths(topic, projectFolderNameOverride, projectIdOverride) {
  const normalizedProjectId = typeof projectIdOverride === "string" ? projectIdOverride.trim() : "";
  const projectId = normalizedProjectId || (
    typeof projectFolderNameOverride === "string" && projectFolderNameOverride.trim()
      ? projectFolderNameOverride.trim()
      : createProjectId()
  );
  const projectFolderName = typeof projectFolderNameOverride === "string" && projectFolderNameOverride.trim()
    ? projectFolderNameOverride.trim()
    : `${sanitizeProjectId(projectId)}-${sanitizeProjectFolderName(topic)}`;
  const projectDirectory = path.join(projectsDirectory, projectFolderName);
  const scriptsDirectory = path.join(projectDirectory, "scripts");
  const imagesDirectory = path.join(projectDirectory, "images");
  const videosDirectory = path.join(projectDirectory, "videos");

  return {
    projectId,
    projectFolderName,
    projectDirectory,
    scriptsDirectory,
    imagesDirectory,
    videosDirectory,
    projectFilePath: path.join(projectDirectory, "project.json"),
    scriptFilePath: path.join(scriptsDirectory, "scene-script.json"),
  };
}

/**
 * 프로젝트별 결과 저장 폴더와 하위 자산 폴더를 보장한다.
 */
async function ensureProjectDirectories(topic, projectFolderNameOverride, projectIdOverride) {
  const storagePaths = createProjectStoragePaths(topic, projectFolderNameOverride, projectIdOverride);
  const directoriesToCreate = [
    projectsDirectory,
    storagePaths.projectDirectory,
    ...projectAssetFolderNames.map((folderName) => path.join(storagePaths.projectDirectory, folderName)),
  ];

  for (const directoryPath of directoriesToCreate) {
    await fs.promises.mkdir(directoryPath, { recursive: true });
  }

  return storagePaths;
}

/**
 * 장면 스크립트 저장용 장면 데이터를 현재 형식으로 정리한다.
 */
function normalizeScriptSceneItem(sceneItem) {
  return {
    summary: typeof sceneItem?.summary === "string" ? sceneItem.summary : "",
    narration: typeof sceneItem?.narration === "string" ? sceneItem.narration : "",
    durationSeconds: Number.isInteger(sceneItem?.durationSeconds) ? sceneItem.durationSeconds : 0,
    imagePrompt: typeof sceneItem?.imagePrompt === "string" ? sceneItem.imagePrompt : "",
    videoPrompt: typeof sceneItem?.videoPrompt === "string" ? sceneItem.videoPrompt : "",
  };
}

/**
 * 프로젝트 대표 상태 JSON 본문을 만든다.
 */
function createProjectStatePayload(projectMeta, imageItems, videoItems) {
  return {
    projectTopic: projectMeta.topic,
    projectId: projectMeta.projectId,
    projectFolderName: projectMeta.projectFolderName,
    tone: projectMeta.tone,
    style: projectMeta.style,
    sceneCount: projectMeta.sceneCount,
    savedAt: new Date().toISOString(),
    scriptFilePath: "scripts/scene-script.json",
    images: imageItems.map((imageItem) => ({
      sceneIndex: imageItem.sceneIndex,
      filePath: imageItem.filePath,
    })),
    videos: videoItems.map((videoItem) => ({
      sceneIndex: videoItem.sceneIndex,
      filePath: videoItem.filePath,
    })),
  };
}

/**
 * 프로젝트 대표 상태 JSON을 저장한다.
 */
async function saveProjectStateToProject(projectMeta, imageItems, videoItems) {
  const projectFilePayload = createProjectStatePayload(projectMeta, imageItems, videoItems);

  await fs.promises.writeFile(
    projectMeta.projectFilePath,
    JSON.stringify(projectFilePayload, null, 2),
    "utf8"
  );
}

/**
 * 생성된 장면 스크립트를 프로젝트 폴더 안의 JSON 파일로 저장한다.
 */
async function saveSceneScriptsToProject(scriptRequest, sceneItems) {
  const storagePaths = await ensureProjectDirectories(scriptRequest.topic, scriptRequest.projectFolderName, scriptRequest.projectId);
  const scriptFilePayload = {
    projectTopic: scriptRequest.topic,
    projectId: storagePaths.projectId,
    projectFolderName: storagePaths.projectFolderName,
    tone: scriptRequest.tone,
    style: scriptRequest.style,
    sceneCount: sceneItems.length,
    savedAt: new Date().toISOString(),
    scenes: sceneItems.map((sceneItem) => normalizeScriptSceneItem(sceneItem)),
  };

  await fs.promises.writeFile(
    storagePaths.scriptFilePath,
    JSON.stringify(scriptFilePayload, null, 2),
    "utf8"
  );

  await saveProjectStateToProject(
    {
      topic: scriptRequest.topic,
      projectId: storagePaths.projectId,
      projectFolderName: storagePaths.projectFolderName,
      tone: scriptRequest.tone,
      style: scriptRequest.style,
      projectFilePath: storagePaths.projectFilePath,
      sceneCount: sceneItems.length,
    },
    [],
    []
  );
  upsertProjectBasicInfo({
    projectId: storagePaths.projectId,
    folderName: storagePaths.projectFolderName,
    name: scriptRequest.topic,
    topic: scriptRequest.topic,
    tone: scriptRequest.tone,
    style: scriptRequest.style,
    sceneCount: sceneItems.length,
    projectFilePath: storagePaths.projectFilePath,
    scriptFilePath: storagePaths.scriptFilePath,
  });

  return storagePaths;
}

/**
 * 생성된 장면 이미지를 프로젝트 폴더 안의 파일로 저장한다.
 */
async function saveSceneImageToProject(imageRequest, imageBase64, outputFormat) {
  const storagePaths = await ensureProjectDirectories(imageRequest.topic, imageRequest.projectFolderName, imageRequest.projectId);
  const normalizedFormat = outputFormat === "jpeg" ? "jpeg" : "png";
  const sceneNumber = String(imageRequest.sceneIndex + 1).padStart(2, "0");
  const imageFileName = `${sanitizeProjectId(storagePaths.projectId)}-image-scene-${sceneNumber}.${normalizedFormat}`;
  const imageFilePath = path.join(storagePaths.imagesDirectory, imageFileName);
  const imageWebPath = `/projects/${encodeURIComponent(storagePaths.projectFolderName)}/images/${encodeURIComponent(imageFileName)}`;
  const imageBytes = Buffer.from(imageBase64, "base64");

  await fs.promises.writeFile(imageFilePath, imageBytes);

  return {
    ...storagePaths,
    imageFileName,
    imageFilePath,
    imageWebPath,
  };
}

/**
 * 원격 영상 URL을 프로젝트 폴더 안의 파일로 내려받아 저장한다.
 */
function downloadVideoFile(videoUrl) {
  return new Promise((resolve, reject) => {
    https.get(videoUrl, (downloadResponse) => {
      const responseChunks = [];

      if (downloadResponse.statusCode && downloadResponse.statusCode >= 400) {
        reject(new Error("생성된 영상을 내려받지 못했습니다."));
        return;
      }

      downloadResponse.on("data", (chunk) => {
        responseChunks.push(chunk);
      });

      downloadResponse.on("end", () => {
        resolve(Buffer.concat(responseChunks));
      });
    }).on("error", (error) => {
      reject(new Error(error instanceof Error ? error.message : "영상 파일 다운로드 중 오류가 발생했습니다."));
    });
  });
}

/**
 * 생성된 장면 영상을 프로젝트 폴더 안의 파일로 저장한다.
 */
async function saveSceneVideoToProject(videoRequest, videoUrl) {
  const storagePaths = await ensureProjectDirectories(videoRequest.topic, videoRequest.projectFolderName, videoRequest.projectId);
  const sceneNumber = String(videoRequest.sceneIndex + 1).padStart(2, "0");
  const videoFileName = `${sanitizeProjectId(storagePaths.projectId)}-video-scene-${sceneNumber}.mp4`;
  const videoFilePath = path.join(storagePaths.videosDirectory, videoFileName);
  const videoWebPath = `/projects/${encodeURIComponent(storagePaths.projectFolderName)}/videos/${encodeURIComponent(videoFileName)}`;
  const videoBytes = await downloadVideoFile(videoUrl);

  await fs.promises.writeFile(videoFilePath, videoBytes);

  return {
    ...storagePaths,
    videoFileName,
    videoFilePath,
    videoWebPath,
  };
}

/**
 * 프로젝트 대표 JSON에 생성된 이미지 상태를 반영한다.
 */
async function updateProjectSceneImageState(imageRequest, savedImageResult) {
  const storagePaths = createProjectStoragePaths(imageRequest.topic, imageRequest.projectFolderName, imageRequest.projectId);
  let projectPayload = null;

  try {
    const rawProjectText = await fs.promises.readFile(storagePaths.projectFilePath, "utf8");
    projectPayload = JSON.parse(rawProjectText);
  } catch (error) {
    const rawScriptText = await fs.promises.readFile(storagePaths.scriptFilePath, "utf8");
    const scriptPayload = JSON.parse(rawScriptText);

    projectPayload = createProjectStatePayload(
      {
        topic: typeof scriptPayload.projectTopic === "string" ? scriptPayload.projectTopic : imageRequest.topic,
        projectId: typeof scriptPayload.projectId === "string" ? scriptPayload.projectId : storagePaths.projectId,
        projectFolderName: storagePaths.projectFolderName,
        tone: typeof scriptPayload.tone === "string" ? scriptPayload.tone : "",
        style: typeof scriptPayload.style === "string" ? scriptPayload.style : "",
        projectFilePath: storagePaths.projectFilePath,
        sceneCount: Array.isArray(scriptPayload.scenes) ? scriptPayload.scenes.length : 0,
      },
      [],
      []
    );
  }

  const imageItems = Array.isArray(projectPayload.images) ? projectPayload.images : [];
  const filteredImageItems = imageItems.filter((imageItem) => imageItem?.sceneIndex !== imageRequest.sceneIndex);
  filteredImageItems.push({
    sceneIndex: imageRequest.sceneIndex,
    filePath: `images/${savedImageResult.imageFileName}`,
  });
  filteredImageItems.sort((leftItem, rightItem) => leftItem.sceneIndex - rightItem.sceneIndex);

  const nextProjectPayload = {
    ...projectPayload,
    projectTopic: typeof projectPayload.projectTopic === "string" ? projectPayload.projectTopic : imageRequest.topic,
    projectId: typeof projectPayload.projectId === "string" ? projectPayload.projectId : storagePaths.projectId,
    projectFolderName: storagePaths.projectFolderName,
    scriptFilePath: "scripts/scene-script.json",
    savedAt: new Date().toISOString(),
    images: filteredImageItems,
  };

  await fs.promises.writeFile(
    storagePaths.projectFilePath,
    JSON.stringify(nextProjectPayload, null, 2),
    "utf8"
  );
}

/**
 * 프로젝트 대표 JSON에 생성된 영상 상태를 반영한다.
 */
async function updateProjectSceneVideoState(videoRequest, savedVideoResult) {
  const storagePaths = createProjectStoragePaths(videoRequest.topic, videoRequest.projectFolderName, videoRequest.projectId);
  let projectPayload = null;

  try {
    const rawProjectText = await fs.promises.readFile(storagePaths.projectFilePath, "utf8");
    projectPayload = JSON.parse(rawProjectText);
  } catch (error) {
    const rawScriptText = await fs.promises.readFile(storagePaths.scriptFilePath, "utf8");
    const scriptPayload = JSON.parse(rawScriptText);

    projectPayload = createProjectStatePayload(
      {
        topic: typeof scriptPayload.projectTopic === "string" ? scriptPayload.projectTopic : videoRequest.topic,
        projectId: typeof scriptPayload.projectId === "string" ? scriptPayload.projectId : storagePaths.projectId,
        projectFolderName: storagePaths.projectFolderName,
        tone: typeof scriptPayload.tone === "string" ? scriptPayload.tone : "",
        style: typeof scriptPayload.style === "string" ? scriptPayload.style : "",
        projectFilePath: storagePaths.projectFilePath,
        sceneCount: Array.isArray(scriptPayload.scenes) ? scriptPayload.scenes.length : 0,
      },
      [],
      []
    );
  }

  const videoItems = Array.isArray(projectPayload.videos) ? projectPayload.videos : [];
  const filteredVideoItems = videoItems.filter((videoItem) => videoItem?.sceneIndex !== videoRequest.sceneIndex);
  filteredVideoItems.push({
    sceneIndex: videoRequest.sceneIndex,
    filePath: `videos/${savedVideoResult.videoFileName}`,
  });
  filteredVideoItems.sort((leftItem, rightItem) => leftItem.sceneIndex - rightItem.sceneIndex);

  const nextProjectPayload = {
    ...projectPayload,
    projectTopic: typeof projectPayload.projectTopic === "string" ? projectPayload.projectTopic : videoRequest.topic,
    projectId: typeof projectPayload.projectId === "string" ? projectPayload.projectId : storagePaths.projectId,
    projectFolderName: storagePaths.projectFolderName,
    scriptFilePath: "scripts/scene-script.json",
    savedAt: new Date().toISOString(),
    videos: filteredVideoItems,
  };

  await fs.promises.writeFile(
    storagePaths.projectFilePath,
    JSON.stringify(nextProjectPayload, null, 2),
    "utf8"
  );
}

/**
 * 장면 생성 결과 메타데이터를 DB에 저장한다.
 */
function saveSceneResultMetadata(sceneRequest, resultType, resultState) {
  const storagePaths = createProjectStoragePaths(sceneRequest.topic, sceneRequest.projectFolderName, sceneRequest.projectId);
  const prompt = resultType === "image" ? sceneRequest.imagePrompt : sceneRequest.videoPrompt;

  upsertSceneResult({
    projectId: storagePaths.projectId,
    projectFolderName: storagePaths.projectFolderName,
    sceneIndex: sceneRequest.sceneIndex,
    resultType,
    url: typeof resultState.url === "string" ? resultState.url : "",
    status: typeof resultState.status === "string" ? resultState.status : "idle",
    errorMessage: typeof resultState.errorMessage === "string" ? resultState.errorMessage : "",
    prompt: typeof prompt === "string" ? prompt : "",
  });
  touchProjectUpdatedAt(storagePaths.projectFolderName, storagePaths.projectId);
}

/**
 * 파일 경로 확장자를 기준으로 MIME 타입을 계산한다.
 */
function getMimeTypeFromFilePath(filePath) {
  return contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * 프로젝트 안의 상대 이미지 경로를 실제 파일 경로로 변환한다.
 */
function resolveProjectImageFilePath(videoRequest) {
  const storagePaths = createProjectStoragePaths(videoRequest.topic, videoRequest.projectFolderName, videoRequest.projectId);
  const candidatePath = path.isAbsolute(videoRequest.sourceImagePath)
    ? videoRequest.sourceImagePath
    : path.join(storagePaths.projectDirectory, videoRequest.sourceImagePath.replaceAll("/", path.sep));
  const normalizedPath = path.normalize(candidatePath);

  if (!normalizedPath.startsWith(storagePaths.projectDirectory)) {
    throw new Error("프로젝트 이미지 경로가 올바르지 않습니다.");
  }

  return normalizedPath;
}

/**
 * 로컬 이미지 파일을 EvoLink 파일 업로드 API에 올리고 공개 URL을 돌려받는다.
 */
function uploadImageFileToEvoLink(videoRequest, requestId) {
  return new Promise(async (resolve, reject) => {
    try {
      const imageFilePath = resolveProjectImageFilePath(videoRequest);
      const imageBytes = await fs.promises.readFile(imageFilePath);
      const requestPayload = JSON.stringify({
        base64_data: `data:${getMimeTypeFromFilePath(imageFilePath)};base64,${imageBytes.toString("base64")}`,
        upload_path: `projects/${videoRequest.projectId || videoRequest.projectFolderName}/videos/source-images`,
        file_name: path.basename(imageFilePath),
      });

      logServerEvent(`[영상 생성 ${requestId}] EvoLink 파일 업로드 시작`, {
        sceneIndex: videoRequest.sceneIndex,
        imageFilePath,
      });

      const apiRequest = https.request(
        {
          hostname: evolinkFilesApiHost,
          path: evolinkBase64UploadPath,
          method: "POST",
          headers: {
            Authorization: `Bearer ${videoRequest.klingApiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(requestPayload),
          },
        },
        (apiResponse) => {
          const responseChunks = [];

          apiResponse.on("data", (chunk) => {
            responseChunks.push(chunk);
          });

          apiResponse.on("end", () => {
            try {
              const rawResponse = Buffer.concat(responseChunks).toString("utf8");
              const parsedResponse = JSON.parse(rawResponse);

              if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
                reject(new Error(parsedResponse.msg || parsedResponse.error?.message || "EvoLink 파일 업로드에 실패했습니다."));
                return;
              }

              const uploadedFileUrl = typeof parsedResponse.data?.file_url === "string" ? parsedResponse.data.file_url : "";

              if (!uploadedFileUrl) {
                throw new Error("업로드된 이미지 URL을 읽지 못했습니다.");
              }

              logServerEvent(`[영상 생성 ${requestId}] EvoLink 파일 업로드 완료`, {
                uploadedFileUrl,
              });
              resolve(uploadedFileUrl);
            } catch (error) {
              reject(new Error(error instanceof Error ? error.message : "EvoLink 업로드 응답을 해석하지 못했습니다."));
            }
          });
        }
      );

      apiRequest.on("error", (error) => {
        reject(new Error(error instanceof Error ? error.message : "EvoLink 업로드 통신 중 오류가 발생했습니다."));
      });

      apiRequest.write(requestPayload);
      apiRequest.end();
    } catch (error) {
      reject(new Error(error instanceof Error ? error.message : "영상 생성용 이미지를 준비하지 못했습니다."));
    }
  });
}

/**
 * EvoLink 영상 생성 작업을 시작한다.
 */
function requestEvoLinkVideoTask(videoRequest, sourceImageUrl, requestId) {
  return new Promise((resolve, reject) => {
    const requestPayload = JSON.stringify({
      model: evolinkVideoModel,
      prompt: videoRequest.videoPrompt,
      image_urls: [sourceImageUrl],
    });

    logServerEvent(`[영상 생성 ${requestId}] EvoLink 영상 생성 요청 시작`, {
      model: evolinkVideoModel,
      sceneIndex: videoRequest.sceneIndex,
    });

    const apiRequest = https.request(
      {
        hostname: evolinkApiHost,
        path: evolinkVideoGenerationPath,
        method: "POST",
        headers: {
          Authorization: `Bearer ${videoRequest.klingApiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestPayload),
        },
      },
      (apiResponse) => {
        const responseChunks = [];

        apiResponse.on("data", (chunk) => {
          responseChunks.push(chunk);
        });

        apiResponse.on("end", () => {
          try {
            const rawResponse = Buffer.concat(responseChunks).toString("utf8");
            const parsedResponse = JSON.parse(rawResponse);

            if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
              reject(new Error(parsedResponse.error?.message || parsedResponse.msg || "EvoLink 영상 생성 요청에 실패했습니다."));
              return;
            }

            if (typeof parsedResponse.id !== "string" || !parsedResponse.id.trim()) {
              throw new Error("EvoLink 작업 ID를 받지 못했습니다.");
            }

            resolve(parsedResponse);
          } catch (error) {
            reject(new Error(error instanceof Error ? error.message : "EvoLink 영상 생성 응답을 해석하지 못했습니다."));
          }
        });
      }
    );

    apiRequest.on("error", (error) => {
      reject(new Error(error instanceof Error ? error.message : "EvoLink 영상 생성 통신 중 오류가 발생했습니다."));
    });

    apiRequest.write(requestPayload);
    apiRequest.end();
  });
}

/**
 * EvoLink 비동기 작업 상태를 조회한다.
 */
function requestEvoLinkTaskStatus(taskId, apiKey) {
  return new Promise((resolve, reject) => {
    const apiRequest = https.request(
      {
        hostname: evolinkApiHost,
        path: `${evolinkTaskPathPrefix}${encodeURIComponent(taskId)}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (apiResponse) => {
        const responseChunks = [];

        apiResponse.on("data", (chunk) => {
          responseChunks.push(chunk);
        });

        apiResponse.on("end", () => {
          try {
            const rawResponse = Buffer.concat(responseChunks).toString("utf8");
            const parsedResponse = JSON.parse(rawResponse);

            if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
              reject(new Error(parsedResponse.error?.message || parsedResponse.msg || "EvoLink 작업 상태 조회에 실패했습니다."));
              return;
            }

            resolve(parsedResponse);
          } catch (error) {
            reject(new Error(error instanceof Error ? error.message : "EvoLink 작업 상태 응답을 해석하지 못했습니다."));
          }
        });
      }
    );

    apiRequest.on("error", (error) => {
      reject(new Error(error instanceof Error ? error.message : "EvoLink 작업 상태 통신 중 오류가 발생했습니다."));
    });

    apiRequest.end();
  });
}

/**
 * 지정한 시간만큼 기다린다.
 */
function delay(waitMilliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, waitMilliseconds);
  });
}

/**
 * EvoLink 영상 작업이 끝날 때까지 polling 하고 결과 URL을 돌려준다.
 */
async function waitForEvoLinkVideoResult(taskId, apiKey, requestId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= evolinkVideoPollingTimeoutMs) {
    const taskStatus = await requestEvoLinkTaskStatus(taskId, apiKey);
    const normalizedStatus = typeof taskStatus.status === "string" ? taskStatus.status : "";

    logServerEvent(`[영상 생성 ${requestId}] EvoLink 작업 상태 조회`, {
      taskId,
      status: normalizedStatus,
      progress: typeof taskStatus.progress === "number" ? taskStatus.progress : 0,
    });

    if (normalizedStatus === "completed") {
      const videoResults = Array.isArray(taskStatus.results) ? taskStatus.results : [];
      const videoUrl = typeof videoResults[0] === "string" ? videoResults[0] : "";

      if (!videoUrl) {
        throw new Error("생성된 영상 URL을 읽지 못했습니다.");
      }

      return {
        taskId,
        videoUrl,
      };
    }

    if (normalizedStatus === "failed") {
      throw new Error(taskStatus.error?.message || "EvoLink 영상 생성 작업이 실패했습니다.");
    }

    await delay(evolinkVideoPollingIntervalMs);
  }

  throw new Error("영상 생성 시간이 길어져 응답 대기 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
}

/**
 * Structured Outputs용 장면 스크립트 JSON 스키마를 반환한다.
 */
function createSceneSchema(sceneCount) {
  return {
    name: "scene_script_response",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scenes: {
          type: "array",
          minItems: sceneCount,
          maxItems: sceneCount,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: {
                type: "string",
                description: "장면 요약 한글 설명",
              },
              narration: {
                type: "string",
                description: "영상 길이에 맞는 한글 나레이션",
              },
              durationSeconds: {
                type: "integer",
                enum: supportedDurations,
                description: "3초에서 5초 사이의 영상 길이",
              },
              imagePrompt: {
                type: "string",
                description: "장면 이미지 생성용 영어 프롬프트",
              },
              videoPrompt: {
                type: "string",
                description: "장면 영상 생성용 영어 프롬프트",
              },
            },
            required: ["summary", "narration", "durationSeconds", "imagePrompt", "videoPrompt"],
          },
        },
      },
      required: ["scenes"],
    },
  };
}

/**
 * OpenAI Responses API에 장면 스크립트 생성을 요청한다.
 */
function requestOpenAiSceneScripts(scriptRequest, requestId) {
  return new Promise((resolve, reject) => {
    logServerEvent(`[스크립트 생성 ${requestId}] OpenAI Responses API 요청 시작`, {
      model: "gpt-5.5",
      sceneCount: scriptRequest.sceneCount,
      tone: scriptRequest.tone,
      style: scriptRequest.style,
    });

    const requestPayload = JSON.stringify({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "당신은 한국어 숏폼 영상 장면 기획자다. 반드시 지정된 JSON 스키마만 반환한다. " +
                "각 장면은 자연스럽게 이어져야 하며, summary와 narration은 한국어로 작성한다. " +
                "imagePrompt와 videoPrompt는 영어로 작성한다. " +
                "durationSeconds는 3, 4, 5 중 하나만 사용한다. " +
                "narration은 durationSeconds 길이에 맞게 짧고 말하기 쉬운 분량으로 작성한다.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `주제: ${scriptRequest.topic}\n` +
                `분위기: ${scriptRequest.tone}\n` +
                `스타일: ${scriptRequest.style}\n` +
                `장면 수: ${scriptRequest.sceneCount}\n` +
                "각 장면에는 한글 설명 요약, 한글 나레이션, 영상 길이, 이미지 생성용 영어 프롬프트, 영상 생성용 영어 프롬프트가 필요하다. " +
                "모든 장면은 영상 길이가 3초에서 5초 사이가 되도록 구성해 줘.",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...createSceneSchema(scriptRequest.sceneCount),
        },
      },
    });

    const apiRequest = https.request(
      {
        hostname: openAiApiHost,
        path: openAiResponsesPath,
        method: "POST",
        headers: {
          Authorization: `Bearer ${scriptRequest.openaiApiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestPayload),
        },
      },
      (apiResponse) => {
        const responseChunks = [];

        apiResponse.on("data", (chunk) => {
          responseChunks.push(chunk);
        });

        apiResponse.on("end", () => {
          try {
            const rawResponse = Buffer.concat(responseChunks).toString("utf8");
            const parsedResponse = JSON.parse(rawResponse);
            logServerEvent(`[스크립트 생성 ${requestId}] OpenAI 응답 수신`, {
              statusCode: apiResponse.statusCode || 0,
            });

            if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
              const errorMessage = parsedResponse.error?.message || "OpenAI API 요청에 실패했습니다.";
              logServerEvent(`[스크립트 생성 ${requestId}] OpenAI 요청 실패`, {
                statusCode: apiResponse.statusCode,
                message: errorMessage,
              });
              reject(new Error(errorMessage));
              return;
            }

            const outputText = extractOutputText(parsedResponse);
            const parsedScenePayload = JSON.parse(outputText);
            const sceneItems = Array.isArray(parsedScenePayload.scenes) ? parsedScenePayload.scenes : [];

            logServerEvent(`[스크립트 생성 ${requestId}] OpenAI 응답 해석 완료`, {
              sceneCount: sceneItems.length,
            });
            resolve(parsedScenePayload);
          } catch (error) {
            logServerEvent(`[스크립트 생성 ${requestId}] OpenAI 응답 해석 실패`, {
              message: error instanceof Error ? error.message : "알 수 없는 오류",
            });
            reject(new Error("OpenAI 응답을 해석하지 못했습니다."));
          }
        });
      }
    );

    apiRequest.on("error", (error) => {
      logServerEvent(`[스크립트 생성 ${requestId}] OpenAI 통신 오류`, {
        message: error instanceof Error ? error.message : "알 수 없는 오류",
      });
      reject(new Error("OpenAI API 통신 중 오류가 발생했습니다."));
    });

    apiRequest.write(requestPayload);
    apiRequest.end();
  });
}

/**
 * OpenAI Image API에 장면 이미지 생성을 요청한다.
 */
function requestOpenAiSceneImage(imageRequest, requestId) {
  return new Promise((resolve, reject) => {
    logServerEvent(`[이미지 생성 ${requestId}] OpenAI Image API 요청 시작`, {
      model: "gpt-image-2",
      sceneIndex: imageRequest.sceneIndex,
    });

    const requestPayload = JSON.stringify({
      model: "gpt-image-2",
      prompt: imageRequest.imagePrompt,
      size: "1024x1024",
      quality: "medium",
      output_format: imageOutputFormat,
    });

    const apiRequest = https.request(
      {
        hostname: openAiApiHost,
        path: openAiImagesPath,
        method: "POST",
        headers: {
          Authorization: `Bearer ${imageRequest.openaiApiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestPayload),
        },
      },
      (apiResponse) => {
        const responseChunks = [];

        apiResponse.on("data", (chunk) => {
          responseChunks.push(chunk);
        });

        apiResponse.on("end", () => {
          try {
            const rawResponse = Buffer.concat(responseChunks).toString("utf8");
            const parsedResponse = JSON.parse(rawResponse);
            logServerEvent(`[이미지 생성 ${requestId}] OpenAI 응답 수신`, {
              statusCode: apiResponse.statusCode || 0,
            });

            if (apiResponse.statusCode && apiResponse.statusCode >= 400) {
              const errorMessage = parsedResponse.error?.message || "OpenAI 이미지 생성 요청에 실패했습니다.";
              logServerEvent(`[이미지 생성 ${requestId}] OpenAI 요청 실패`, {
                statusCode: apiResponse.statusCode,
                message: errorMessage,
              });
              reject(new Error(errorMessage));
              return;
            }

            const imageItem = Array.isArray(parsedResponse.data) ? parsedResponse.data[0] : null;

            if (!imageItem || typeof imageItem.b64_json !== "string") {
              throw new Error("생성된 이미지 응답이 비어 있습니다.");
            }

            logServerEvent(`[이미지 생성 ${requestId}] OpenAI 응답 해석 완료`, {
              hasRevisedPrompt: typeof imageItem.revised_prompt === "string" && imageItem.revised_prompt.length > 0,
            });
            resolve({
              base64: imageItem.b64_json,
              revisedPrompt: typeof imageItem.revised_prompt === "string" ? imageItem.revised_prompt : "",
              outputFormat: imageOutputFormat,
            });
          } catch (error) {
            logServerEvent(`[이미지 생성 ${requestId}] OpenAI 응답 해석 실패`, {
              message: error instanceof Error ? error.message : "알 수 없는 오류",
            });
            reject(new Error(error instanceof Error ? error.message : "OpenAI 이미지 응답을 해석하지 못했습니다."));
          }
        });
      }
    );

    apiRequest.on("error", (error) => {
      logServerEvent(`[이미지 생성 ${requestId}] OpenAI 통신 오류`, {
        message: error instanceof Error ? error.message : "알 수 없는 오류",
      });
      reject(new Error("OpenAI API 통신 중 오류가 발생했습니다."));
    });

    apiRequest.write(requestPayload);
    apiRequest.end();
  });
}

/**
 * Responses API 응답에서 최종 텍스트 출력을 추출한다.
 */
function extractOutputText(apiResponsePayload) {
  const outputItems = Array.isArray(apiResponsePayload.output) ? apiResponsePayload.output : [];

  for (const outputItem of outputItems) {
    if (outputItem.type !== "message" || !Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        return contentItem.text;
      }
    }
  }

  throw new Error("생성된 스크립트 응답이 비어 있습니다.");
}

/**
 * 장면 스크립트 생성 API 요청을 처리한다.
 */
async function handleGenerateScriptRequest(request, response) {
  const requestId = String(++scriptRequestSequence).padStart(3, "0");

  try {
    logServerEvent(`[스크립트 생성 ${requestId}] 요청 수신`);
    const requestBody = await readJsonBody(request);
    const validatedPayload = validateScriptRequestPayload(requestBody);
    logServerEvent(`[스크립트 생성 ${requestId}] 요청 검증 완료`, {
      topic: validatedPayload.topic,
      tone: validatedPayload.tone,
      style: validatedPayload.style,
      sceneCount: validatedPayload.sceneCount,
      hasOpenAiApiKey: Boolean(validatedPayload.openaiApiKey),
    });

    const sceneResponse = await requestOpenAiSceneScripts(validatedPayload, requestId);
    const sceneItems = Array.isArray(sceneResponse.scenes) ? sceneResponse.scenes : [];
    const projectStorage = await saveSceneScriptsToProject(validatedPayload, sceneItems);

    logServerEvent(`[스크립트 생성 ${requestId}] 프로젝트 저장 완료`, {
      projectId: projectStorage.projectId,
      projectFolderName: projectStorage.projectFolderName,
      scriptFilePath: projectStorage.scriptFilePath,
    });
    logServerEvent(`[스크립트 생성 ${requestId}] 응답 반환 완료`, {
      sceneCount: sceneItems.length,
    });

    sendJson(response, 200, {
      scenes: sceneItems,
      project: {
        projectId: projectStorage.projectId,
        folderName: projectStorage.projectFolderName,
        projectFilePath: projectStorage.projectFilePath,
        scriptFilePath: projectStorage.scriptFilePath,
      },
    });
  } catch (error) {
    logServerEvent(`[스크립트 생성 ${requestId}] 요청 처리 실패`, {
      message: error instanceof Error ? error.message : "스크립트 생성 요청에 실패했습니다.",
    });
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "스크립트 생성 요청에 실패했습니다.",
    });
  }
}

/**
 * 장면 이미지 생성 API 요청을 처리한다.
 */
async function handleGenerateImageRequest(request, response) {
  const requestId = String(++imageRequestSequence).padStart(3, "0");
  let validatedPayload = null;

  try {
    logServerEvent(`[이미지 생성 ${requestId}] 요청 수신`);
    const requestBody = await readJsonBody(request);
    validatedPayload = validateImageRequestPayload(requestBody);
    logServerEvent(`[이미지 생성 ${requestId}] 요청 검증 완료`, {
      topic: validatedPayload.topic,
      projectId: validatedPayload.projectId,
      projectFolderName: validatedPayload.projectFolderName,
      sceneIndex: validatedPayload.sceneIndex,
      hasOpenAiApiKey: Boolean(validatedPayload.openaiApiKey),
    });

    const generatedImage = await requestOpenAiSceneImage(validatedPayload, requestId);
    const projectStorage = await saveSceneImageToProject(
      validatedPayload,
      generatedImage.base64,
      generatedImage.outputFormat
    );
    await updateProjectSceneImageState(validatedPayload, projectStorage);
    saveSceneResultMetadata(validatedPayload, "image", {
      url: projectStorage.imageWebPath,
      status: "success",
      errorMessage: "",
    });

    logServerEvent(`[이미지 생성 ${requestId}] 프로젝트 저장 완료`, {
      projectId: projectStorage.projectId,
      projectFolderName: projectStorage.projectFolderName,
      imageFilePath: projectStorage.imageFilePath,
      imageWebPath: projectStorage.imageWebPath,
    });
    logServerEvent(`[이미지 생성 ${requestId}] 응답 반환 완료`, {
      sceneIndex: validatedPayload.sceneIndex,
    });

    sendJson(response, 200, {
      image: {
        outputFormat: generatedImage.outputFormat,
        revisedPrompt: generatedImage.revisedPrompt,
        filePath: projectStorage.imageFilePath,
        webPath: projectStorage.imageWebPath,
        dbUrl: projectStorage.imageWebPath,
        status: "success",
      },
      project: {
        projectId: projectStorage.projectId,
        folderName: projectStorage.projectFolderName,
        projectFilePath: projectStorage.projectFilePath,
        scriptFilePath: projectStorage.scriptFilePath,
      },
    });
  } catch (error) {
    logServerEvent(`[이미지 생성 ${requestId}] 요청 처리 실패`, {
      projectId: validatedPayload?.projectId,
      projectFolderName: validatedPayload?.projectFolderName,
      sceneIndex: validatedPayload?.sceneIndex,
      message: error instanceof Error ? error.message : "이미지 생성 요청에 실패했습니다.",
    });

    try {
      if (validatedPayload) {
        saveSceneResultMetadata(validatedPayload, "image", {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "이미지 생성 요청에 실패했습니다.",
        });
      }
    } catch (dbError) {
      logServerEvent(`[이미지 생성 ${requestId}] DB 실패 상태 저장 실패`, {
        message: dbError instanceof Error ? dbError.message : "DB 실패 상태 저장에 실패했습니다.",
      });
    }

    sendJson(response, 400, {
      projectId: validatedPayload?.projectId || "",
      projectFolderName: validatedPayload?.projectFolderName || "",
      sceneIndex: Number.isInteger(validatedPayload?.sceneIndex) ? validatedPayload.sceneIndex : null,
      error: error instanceof Error ? error.message : "이미지 생성 요청에 실패했습니다.",
    });
  }
}

/**
 * 장면 영상 생성 API 요청을 처리한다.
 */
async function handleGenerateVideoRequest(request, response) {
  const requestId = String(++videoRequestSequence).padStart(3, "0");
  let validatedPayload = null;

  try {
    logServerEvent(`[영상 생성 ${requestId}] 요청 수신`);
    const requestBody = await readJsonBody(request);
    validatedPayload = validateVideoRequestPayload(requestBody);
    logServerEvent(`[영상 생성 ${requestId}] 요청 검증 완료`, {
      topic: validatedPayload.topic,
      projectId: validatedPayload.projectId,
      projectFolderName: validatedPayload.projectFolderName,
      sceneIndex: validatedPayload.sceneIndex,
      hasKlingApiKey: Boolean(validatedPayload.klingApiKey),
    });

    const uploadedImageUrl = await uploadImageFileToEvoLink(validatedPayload, requestId);
    const createdTask = await requestEvoLinkVideoTask(validatedPayload, uploadedImageUrl, requestId);
    const completedTask = await waitForEvoLinkVideoResult(createdTask.id, validatedPayload.klingApiKey, requestId);
    const savedVideoResult = await saveSceneVideoToProject(validatedPayload, completedTask.videoUrl);
    await updateProjectSceneVideoState(validatedPayload, savedVideoResult);
    saveSceneResultMetadata(validatedPayload, "video", {
      url: savedVideoResult.videoWebPath,
      status: "success",
      errorMessage: "",
    });

    logServerEvent(`[영상 생성 ${requestId}] 응답 반환 완료`, {
      projectId: savedVideoResult.projectId,
      projectFolderName: savedVideoResult.projectFolderName,
      sceneIndex: validatedPayload.sceneIndex,
      taskId: completedTask.taskId,
      videoWebPath: savedVideoResult.videoWebPath,
    });
    sendJson(response, 200, {
      video: {
        taskId: completedTask.taskId,
        filePath: savedVideoResult.videoFilePath,
        webPath: savedVideoResult.videoWebPath,
        dbUrl: savedVideoResult.videoWebPath,
        status: "success",
        sourceImageUrl: uploadedImageUrl,
      },
      project: {
        projectId: savedVideoResult.projectId,
        folderName: savedVideoResult.projectFolderName,
        projectFilePath: savedVideoResult.projectFilePath,
        scriptFilePath: savedVideoResult.scriptFilePath,
      },
    });
  } catch (error) {
    logServerEvent(`[영상 생성 ${requestId}] 요청 처리 실패`, {
      projectId: validatedPayload?.projectId,
      projectFolderName: validatedPayload?.projectFolderName,
      sceneIndex: validatedPayload?.sceneIndex,
      message: error instanceof Error ? error.message : "영상 생성 요청에 실패했습니다.",
    });

    try {
      if (validatedPayload) {
        saveSceneResultMetadata(validatedPayload, "video", {
          status: "error",
          errorMessage: error instanceof Error ? error.message : "영상 생성 요청에 실패했습니다.",
        });
      }
    } catch (dbError) {
      logServerEvent(`[영상 생성 ${requestId}] DB 실패 상태 저장 실패`, {
        message: dbError instanceof Error ? dbError.message : "DB 실패 상태 저장에 실패했습니다.",
      });
    }

    sendJson(response, 400, {
      projectId: validatedPayload?.projectId || "",
      projectFolderName: validatedPayload?.projectFolderName || "",
      sceneIndex: Number.isInteger(validatedPayload?.sceneIndex) ? validatedPayload.sceneIndex : null,
      error: error instanceof Error ? error.message : "영상 생성 요청에 실패했습니다.",
    });
  }
}

/**
 * DB에 저장된 프로젝트 기본 정보 목록 요청을 처리한다.
 */
function handleListProjectsRequest(response) {
  try {
    sendJson(response, 200, {
      projects: listProjects(),
    });
  } catch (error) {
    logServerEvent("[프로젝트 목록] DB 조회 실패", {
      message: error instanceof Error ? error.message : "프로젝트 목록을 불러오지 못했습니다.",
    });
    sendJson(response, 500, {
      error: "프로젝트 목록을 불러오지 못했습니다.",
    });
  }
}

/**
 * DB 프로젝트 목록에서 선택한 프로젝트의 상태와 장면 데이터를 반환한다.
 */
async function handleGetProjectRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${publicHost}:${PORT}`);
    const projectFolderName = requestUrl.searchParams.get("projectFolderName") || "";
    const projectId = requestUrl.searchParams.get("projectId") || "";
    const projectItem = projectId
      ? getProjectById(projectId)
      : getProjectByFolderName(projectFolderName);

    if (!projectItem) {
      sendJson(response, 404, {
        error: "선택한 프로젝트를 찾지 못했습니다.",
      });
      return;
    }

    const projectState = await readProjectJsonFile(
      projectItem.folderName,
      projectItem.projectFilePath,
      "project.json"
    );
    const scriptPayload = await readProjectJsonFile(
      projectItem.folderName,
      projectItem.scriptFilePath,
      "scripts/scene-script.json"
    );

    sendJson(response, 200, {
      project: projectItem,
      projectState,
      script: scriptPayload,
      sceneResults: listSceneResultsByProject(projectItem.folderName, projectItem.projectId),
    });
  } catch (error) {
    logServerEvent("[프로젝트 불러오기] 프로젝트 조회 실패", {
      message: error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.",
    });
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.",
    });
  }
}

/**
 * DB에 저장된 프로젝트 이미지/영상 결과 목록 요청을 처리한다.
 */
function handleListSceneResultsRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${publicHost}:${PORT}`);
    const projectFolderName = requestUrl.searchParams.get("projectFolderName") || "";
    const projectId = requestUrl.searchParams.get("projectId") || "";

    sendJson(response, 200, {
      results: listSceneResultsByProject(projectFolderName, projectId),
    });
  } catch (error) {
    logServerEvent("[장면 결과 목록] DB 조회 실패", {
      message: error instanceof Error ? error.message : "장면 결과 목록을 불러오지 못했습니다.",
    });
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "장면 결과 목록을 불러오지 못했습니다.",
    });
  }
}

/**
 * 요청 경로에 따라 기본 응답을 분기한다.
 */
function handleRequest(request, response) {
  const requestPath = request.url.split("?")[0];

  if (request.method === "GET" && requestPath === "/api/projects") {
    handleListProjectsRequest(response);
    return;
  }

  if (request.method === "GET" && requestPath === "/api/project") {
    handleGetProjectRequest(request, response);
    return;
  }

  if (request.method === "GET" && requestPath === "/api/scene-results") {
    handleListSceneResultsRequest(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/script/generate") {
    handleGenerateScriptRequest(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/image/generate") {
    handleGenerateImageRequest(request, response);
    return;
  }

  if (request.method === "POST" && requestPath === "/api/video/generate") {
    handleGenerateVideoRequest(request, response);
    return;
  }

  if (requestPath === "/") {
    serveWelcomePage(response);
    return;
  }

  if (requestPath.startsWith("/projects/")) {
    const normalizedProjectPath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
    const projectFilePath = path.join(__dirname, normalizedProjectPath);

    if (projectFilePath.startsWith(projectsDirectory)) {
      serveStaticFile(projectFilePath, request, response);
      return;
    }
  }

  const normalizedRequestPath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDirectory, normalizedRequestPath);

  if (filePath.startsWith(publicDirectory)) {
    serveStaticFile(filePath, request, response);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("페이지를 찾을 수 없습니다.");
}

const server = http.createServer(handleRequest);
const databaseInfo = initializeDatabase();

logServerEvent("SQLite DB 준비 완료", {
  databaseFilePath: databaseInfo.databaseFilePath || databaseFilePath,
});

server.listen(PORT, HOST, () => {
  console.log(`서버가 실행되었습니다: http://${publicHost}:${PORT}`);
  console.log(`같은 네트워크의 다른 PC에서는 이 PC의 내부 IP와 포트 ${PORT}로 접속할 수 있습니다.`);
});

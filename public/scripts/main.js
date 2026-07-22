const tabButtons = document.querySelectorAll("[data-tab-target]");
const contentPanels = document.querySelectorAll("[data-tab-panel]");
const topicInput = document.querySelector("#topic-input");
const topicCount = document.querySelector("#topic-count");
const sceneCountInput = document.querySelector("#scene-count-input");
const stepperButtons = document.querySelectorAll("[data-stepper-action]");
const generateScriptButton = document.querySelector("#generate-script-button");
const generateButtonLabel = document.querySelector(".generate-button__label");
const sceneCardList = document.querySelector("#scene-card-list");
const imageSceneRail = document.querySelector("#image-scene-rail");
const videoSceneRail = document.querySelector("#video-scene-rail");
const sceneStatusBanner = document.querySelector("#scene-status-banner");
const openProjectFileButton = document.querySelector("#open-project-file-button");
const projectListModal = document.querySelector("#project-list-modal");
const projectList = document.querySelector("#project-list");
const projectListStatus = document.querySelector("#project-list-status");
const closeProjectListModalButtons = document.querySelectorAll("[data-close-project-list-modal]");
const openApiKeyModalButton = document.querySelector("#open-api-key-modal-button");
const apiKeyModal = document.querySelector("#api-key-modal");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyInputElements = document.querySelectorAll("[data-api-key-input]");
const closeApiModalButtons = document.querySelectorAll("[data-close-api-modal]");
const apiKeyVisibilityButtons = document.querySelectorAll("[data-toggle-api-visibility]");
const apiKeyStorageKey = "ebsApiKeySettings";
let lastFocusedElement = null;
let latestGeneratedScenes = [];
let currentProjectInfo = {
  projectId: "",
  topic: topicInput ? topicInput.value.trim() : "",
  folderName: topicInput ? sanitizeProjectFolderName(topicInput.value) : "",
};

/**
 * 선택된 탭에 맞춰 보이는 내용 영역만 전환한다.
 */
function activateTab(nextTabName) {
  tabButtons.forEach((button) => {
    const isSelected = button.dataset.tabTarget === nextTabName;

    button.classList.toggle("is-active", isSelected);
    button.setAttribute("aria-selected", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
  });

  contentPanels.forEach((panel) => {
    const isSelected = panel.dataset.tabPanel === nextTabName;

    panel.classList.toggle("is-active", isSelected);
    panel.hidden = !isSelected;
  });
}

/**
 * 영상 주제 입력 글자 수를 현재 제한 길이에 맞춰 표시한다.
 */
function syncTopicCount() {
  if (!topicInput || !topicCount) {
    return;
  }

  const maxLength = Number(topicInput.maxLength) || 500;
  topicCount.textContent = `${topicInput.value.length} / ${maxLength}`;
}

/**
 * 장면 수 입력값을 허용 범위 안의 정수로 보정한다.
 */
function clampSceneCount(nextValue) {
  if (!sceneCountInput) {
    return 3;
  }

  const minCount = Number(sceneCountInput.min) || 3;
  const maxCount = Number(sceneCountInput.max) || 10;
  const parsedValue = Number.parseInt(String(nextValue), 10);

  if (Number.isNaN(parsedValue)) {
    return minCount;
  }

  return Math.min(maxCount, Math.max(minCount, parsedValue));
}

/**
 * 장면 수 입력칸 값을 보정한 뒤 화면에 반영한다.
 */
function syncSceneCount(nextValue) {
  if (!sceneCountInput) {
    return;
  }

  sceneCountInput.value = String(clampSceneCount(nextValue));
}

/**
 * 서버와 같은 규칙으로 프로젝트 폴더 이름을 정리한다.
 */
function sanitizeProjectFolderName(topicValue) {
  const normalizedTopic = String(topicValue || "").normalize("NFC").trim();

  return normalizedTopic
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80) || "project";
}

/**
 * 현재 작업 중인 프로젝트 정보를 화면 상태에 맞춰 갱신한다.
 */
function syncCurrentProjectInfo(topicValue, folderNameValue, projectIdValue) {
  const nextTopic = String(topicValue || "").trim();

  currentProjectInfo = {
    projectId: typeof projectIdValue === "string" ? projectIdValue.trim() : "",
    topic: nextTopic,
    folderName: folderNameValue || sanitizeProjectFolderName(nextTopic),
  };
}

/**
 * 숫자를 장면 순서 안내 문구로 변환한다.
 */
function getSceneOrderLabel(sceneIndex) {
  const sceneOrderLabels = ["첫 번째", "두 번째", "세 번째", "네 번째", "다섯 번째", "여섯 번째", "일곱 번째", "여덟 번째", "아홉 번째", "열 번째"];

  return sceneOrderLabels[sceneIndex] || `${sceneIndex + 1}번째`;
}

/**
 * 스크립트 생성 버튼의 로딩 상태와 문구를 동기화한다.
 */
function setGenerateButtonLoading(isLoading) {
  if (!generateScriptButton || !generateButtonLabel) {
    return;
  }

  generateScriptButton.disabled = isLoading;
  generateScriptButton.classList.toggle("is-loading", isLoading);
  generateButtonLabel.textContent = isLoading ? "생성 중..." : "스크립트 생성";
}

/**
 * 브라우저 저장소에 보관된 API 키 입력값을 읽어온다.
 */
function readStoredApiKeySettings() {
  try {
    const storedValue = window.localStorage.getItem(apiKeyStorageKey);

    if (!storedValue) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue);
    return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
  } catch (error) {
    return {};
  }
}

/**
 * 현재 폼의 API 키 값을 브라우저 저장소에 저장한다.
 */
function saveApiKeySettings() {
  if (!apiKeyForm) {
    return;
  }

  const formData = new FormData(apiKeyForm);
  const nextSettings = {};

  for (const [fieldName, fieldValue] of formData.entries()) {
    nextSettings[fieldName] = String(fieldValue);
  }

  window.localStorage.setItem(apiKeyStorageKey, JSON.stringify(nextSettings));
}

/**
 * 저장된 API 키 값을 모달 입력칸에 반영한다.
 */
function syncApiKeyInputsFromStorage() {
  const storedSettings = readStoredApiKeySettings();

  apiKeyInputElements.forEach((inputElement) => {
    inputElement.value = storedSettings[inputElement.name] || "";
    inputElement.type = "password";
  });

  apiKeyVisibilityButtons.forEach((buttonElement) => {
    buttonElement.textContent = "보기";
  });
}

/**
 * API 키 설정 모달을 열고 첫 번째 입력칸에 초점을 맞춘다.
 */
function openApiKeyModal() {
  if (!apiKeyModal) {
    return;
  }

  lastFocusedElement = document.activeElement;
  syncApiKeyInputsFromStorage();
  apiKeyModal.hidden = false;
  document.body.classList.add("modal-open");

  const firstInput = apiKeyModal.querySelector("[data-api-key-input]");

  if (firstInput) {
    firstInput.focus();
  }
}

/**
 * API 키 설정 모달을 닫고 이전 포커스로 되돌린다.
 */
function closeApiKeyModal() {
  if (!apiKeyModal) {
    return;
  }

  apiKeyModal.hidden = true;
  document.body.classList.remove("modal-open");

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

/**
 * 입력칸의 API 키 마스킹 상태를 전환한다.
 */
function toggleApiKeyVisibility(buttonElement) {
  const inputElement = buttonElement.closest(".api-key-input-box")?.querySelector("[data-api-key-input]");

  if (!inputElement) {
    return;
  }

  const isPasswordType = inputElement.type === "password";
  inputElement.type = isPasswordType ? "text" : "password";
  buttonElement.textContent = isPasswordType ? "숨김" : "보기";
}

/**
 * 현재 입력된 스크립트 설정값을 생성 요청용 객체로 정리한다.
 */
function getScriptGenerationPayload() {
  const selectedTone = document.querySelector("#tone-select");
  const selectedStyle = document.querySelector("#style-select");

  return {
    topic: topicInput ? topicInput.value.trim() : "",
    tone: selectedTone ? selectedTone.value : "",
    style: selectedStyle ? selectedStyle.value : "",
    sceneCount: sceneCountInput ? clampSceneCount(sceneCountInput.value) : 3,
  };
}

/**
 * 상태 배너 문구와 유형을 화면에 반영한다.
 */
function setSceneStatus(message, statusType) {
  if (!sceneStatusBanner) {
    return;
  }

  sceneStatusBanner.textContent = message;
  sceneStatusBanner.dataset.status = statusType;
}

/**
 * 장면 데이터에 이미지 카드용 기본 상태를 채워 넣는다.
 */
function normalizeSceneItem(sceneItem) {
  const generatedImageWebPath = sceneItem?.generatedImageWebPath || "";
  const generatedImageDataUrl = sceneItem?.generatedImageDataUrl || "";
  const hasGeneratedImage = Boolean(generatedImageDataUrl || generatedImageWebPath);
  const generatedVideoWebPath = sceneItem?.generatedVideoWebPath || "";

  return {
    ...sceneItem,
    imageStatus: sceneItem?.imageStatus || (hasGeneratedImage ? "success" : "idle"),
    imageError: sceneItem?.imageError || "",
    generatedImageDataUrl,
    generatedImagePath: sceneItem?.generatedImagePath || "",
    generatedImageWebPath,
    videoStatus: sceneItem?.videoStatus || (generatedVideoWebPath ? "success" : "idle"),
    videoError: sceneItem?.videoError || "",
    generatedVideoWebPath,
  };
}

/**
 * 프로젝트 목록 모달의 안내 상태 문구를 갱신한다.
 */
function setProjectListStatus(message, statusName) {
  if (!projectListStatus) {
    return;
  }

  projectListStatus.textContent = message;
  projectListStatus.dataset.status = statusName;
}

/**
 * 저장된 날짜 문자열을 사용자가 읽기 쉬운 형식으로 바꾼다.
 */
function formatProjectDateTime(dateValue) {
  const parsedDate = new Date(dateValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

/**
 * 서버 DB에 저장된 프로젝트 목록을 조회한다.
 */
async function fetchProjectList() {
  const response = await window.fetch("/api/projects");
  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseData.error || "프로젝트 목록을 불러오지 못했습니다.");
  }

  return Array.isArray(responseData.projects) ? responseData.projects : [];
}

/**
 * 프로젝트 목록을 선택 가능한 버튼 목록으로 그린다.
 */
function renderProjectList(projectItems) {
  if (!projectList) {
    return;
  }

  if (!Array.isArray(projectItems) || projectItems.length === 0) {
    projectList.innerHTML = "";
    setProjectListStatus("저장된 프로젝트가 없습니다.", "empty");
    return;
  }

  projectList.innerHTML = projectItems
    .map((projectItem) => {
      const folderName = typeof projectItem.folderName === "string" ? projectItem.folderName : "";
      const projectId = typeof projectItem.projectId === "string" ? projectItem.projectId : "";
      const projectName = typeof projectItem.name === "string" && projectItem.name.trim()
        ? projectItem.name.trim()
        : folderName;

      return `
        <button
          type="button"
          class="project-list-item"
          data-project-id="${escapeHtml(projectId)}"
          data-project-folder-name="${escapeHtml(folderName)}"
        >
          <span class="project-list-item__name">${escapeHtml(projectName)}</span>
          <span class="project-list-item__dates">
            <span>생성일 ${escapeHtml(formatProjectDateTime(projectItem.createdAt))}</span>
            <span>수정일 ${escapeHtml(formatProjectDateTime(projectItem.updatedAt))}</span>
          </span>
        </button>
      `;
    })
    .join("");

  setProjectListStatus(`${projectItems.length}개의 프로젝트가 있습니다.`, "success");
}

/**
 * 프로젝트 목록 모달을 열고 서버 목록을 새로 조회한다.
 */
async function openProjectListModal() {
  if (!projectListModal || !projectList) {
    return;
  }

  lastFocusedElement = document.activeElement;
  projectListModal.hidden = false;
  document.body.classList.add("modal-open");
  projectList.innerHTML = "";
  setProjectListStatus("프로젝트 목록을 불러오는 중입니다...", "loading");

  try {
    const projectItems = await fetchProjectList();
    renderProjectList(projectItems);

    const firstProjectButton = projectList.querySelector(".project-list-item");

    if (firstProjectButton) {
      firstProjectButton.focus();
    }
  } catch (error) {
    setProjectListStatus(
      error instanceof Error ? error.message : "프로젝트 목록을 불러오지 못했습니다.",
      "error"
    );
  }
}

/**
 * 프로젝트 목록 모달을 닫고 이전 포커스로 되돌린다.
 */
function closeProjectListModal() {
  if (!projectListModal) {
    return;
  }

  projectListModal.hidden = true;
  document.body.classList.remove("modal-open");

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus();
  }
}

/**
 * 특정 장면의 이미지 상태만 부분 갱신한다.
 */
function updateSceneImageState(sceneIndex, nextState) {
  const targetScene = latestGeneratedScenes[sceneIndex];

  if (!targetScene) {
    return;
  }

  latestGeneratedScenes[sceneIndex] = {
    ...targetScene,
    ...nextState,
  };

  renderImageSceneCards(latestGeneratedScenes);
  renderVideoSceneCards(latestGeneratedScenes);
}

/**
 * 특정 장면의 영상 상태만 부분 갱신한다.
 */
function updateSceneVideoState(sceneIndex, nextState) {
  const targetScene = latestGeneratedScenes[sceneIndex];

  if (!targetScene) {
    return;
  }

  latestGeneratedScenes[sceneIndex] = {
    ...targetScene,
    ...nextState,
  };

  renderVideoSceneCards(latestGeneratedScenes);
}

/**
 * 저장된 프로젝트의 스크립트 설정값을 현재 입력칸에 반영한다.
 */
function syncScriptSettingsFromProject(projectPayload) {
  const selectedTone = document.querySelector("#tone-select");
  const selectedStyle = document.querySelector("#style-select");

  if (topicInput && typeof projectPayload.projectTopic === "string") {
    topicInput.value = projectPayload.projectTopic;
    syncTopicCount();
  }

  if (selectedTone && typeof projectPayload.tone === "string") {
    selectedTone.value = projectPayload.tone;
  }

  if (selectedStyle && typeof projectPayload.style === "string") {
    selectedStyle.value = projectPayload.style;
  }

  if (sceneCountInput) {
    const nextSceneCount = Number.isInteger(projectPayload.sceneCount)
      ? projectPayload.sceneCount
      : Array.isArray(projectPayload.scenes)
        ? projectPayload.scenes.length
        : sceneCountInput.value;

    syncSceneCount(nextSceneCount);
  }
}

/**
 * 저장된 프로젝트 파일의 장면 데이터 형식이 현재 화면과 맞는지 확인한다.
 */
function validateProjectFilePayload(projectPayload) {
  if (!projectPayload || typeof projectPayload !== "object") {
    throw new Error("프로젝트 파일 내용을 읽지 못했습니다.");
  }

  const sceneItems = Array.isArray(projectPayload.scenes) ? projectPayload.scenes : null;

  if (!sceneItems || sceneItems.length === 0) {
    throw new Error("장면 데이터가 없는 프로젝트 파일입니다.");
  }

  sceneItems.forEach((sceneItem, index) => {
    const hasRequiredText =
      sceneItem &&
      typeof sceneItem.summary === "string" &&
      typeof sceneItem.narration === "string" &&
      typeof sceneItem.imagePrompt === "string" &&
      typeof sceneItem.videoPrompt === "string";
    const hasValidDuration = Number.isInteger(sceneItem?.durationSeconds);

    if (!hasRequiredText || !hasValidDuration) {
      throw new Error(`장면 ${index + 1} 데이터 형식이 올바르지 않습니다.`);
    }
  });

  return sceneItems;
}

/**
 * 프로젝트 폴더와 상대 경로를 브라우저에서 열 수 있는 서버 경로로 바꾼다.
 */
function createProjectAssetWebPath(projectFolderName, relativeFilePath) {
  const normalizedFolderName = String(projectFolderName || "").trim();
  const normalizedRelativePath = String(relativeFilePath || "").replaceAll("\\", "/").replace(/^\/+/, "");

  if (!normalizedFolderName || !normalizedRelativePath) {
    throw new Error("프로젝트 파일 경로 정보가 올바르지 않습니다.");
  }

  const encodedPathSegments = normalizedRelativePath
    .split("/")
    .filter(Boolean)
    .map((pathSegment) => encodeURIComponent(pathSegment))
    .join("/");

  return `/projects/${encodeURIComponent(normalizedFolderName)}/${encodedPathSegments}`;
}

/**
 * 프로젝트 파일 URL을 프로젝트 안의 상대 파일 경로로 바꾼다.
 */
function createProjectRelativePathFromWebPath(projectFolderName, webPath) {
  const normalizedFolderName = String(projectFolderName || "").trim();
  const normalizedWebPath = String(webPath || "").trim();
  const projectPathPrefix = `/projects/${encodeURIComponent(normalizedFolderName)}/`;

  if (!normalizedFolderName || !normalizedWebPath.startsWith(projectPathPrefix)) {
    return "";
  }

  return normalizedWebPath
    .slice(projectPathPrefix.length)
    .split("/")
    .filter(Boolean)
    .map((pathSegment) => decodeURIComponent(pathSegment))
    .join("/");
}

/**
 * DB에 저장된 프로젝트 장면 결과를 조회한다.
 */
async function fetchProjectSceneResults(projectFolderName, projectId) {
  const normalizedFolderName = String(projectFolderName || "").trim();
  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedFolderName && !normalizedProjectId) {
    return [];
  }

  const queryParams = new URLSearchParams();
  if (normalizedProjectId) {
    queryParams.set("projectId", normalizedProjectId);
  }
  if (normalizedFolderName) {
    queryParams.set("projectFolderName", normalizedFolderName);
  }

  const response = await window.fetch(`/api/scene-results?${queryParams.toString()}`);

  if (!response.ok) {
    return [];
  }

  const responseData = await response.json();
  return Array.isArray(responseData.results) ? responseData.results : [];
}

/**
 * DB에 저장된 이미지와 영상 URL 상태를 장면 데이터에 합친다.
 */
function mergeProjectDbSceneResults(sceneItems, projectFolderName, sceneResults) {
  if (!Array.isArray(sceneResults) || sceneResults.length === 0) {
    return sceneItems.map((sceneItem) => normalizeSceneItem(sceneItem));
  }

  return sceneItems.map((sceneItem, sceneIndex) => {
    const matchedImageResult = sceneResults.find(
      (sceneResult) => sceneResult?.sceneIndex === sceneIndex && sceneResult?.resultType === "image"
    );
    const matchedVideoResult = sceneResults.find(
      (sceneResult) => sceneResult?.sceneIndex === sceneIndex && sceneResult?.resultType === "video"
    );
    const nextSceneItem = { ...sceneItem };

    if (matchedImageResult) {
      nextSceneItem.imageStatus = matchedImageResult.status || nextSceneItem.imageStatus;
      nextSceneItem.imageError = matchedImageResult.errorMessage || "";

      if (matchedImageResult.url) {
        nextSceneItem.generatedImageDataUrl = "";
        nextSceneItem.generatedImageWebPath = matchedImageResult.url;
        nextSceneItem.generatedImagePath = createProjectRelativePathFromWebPath(projectFolderName, matchedImageResult.url);
      } else {
        nextSceneItem.generatedImageDataUrl = "";
        nextSceneItem.generatedImageWebPath = "";
        nextSceneItem.generatedImagePath = "";
      }
    }

    if (matchedVideoResult) {
      nextSceneItem.videoStatus = matchedVideoResult.status || nextSceneItem.videoStatus;
      nextSceneItem.videoError = matchedVideoResult.errorMessage || "";

      if (matchedVideoResult.url) {
        nextSceneItem.generatedVideoWebPath = matchedVideoResult.url;
      } else {
        nextSceneItem.generatedVideoWebPath = "";
      }
    }

    return normalizeSceneItem(nextSceneItem);
  });
}

/**
 * 서버에 저장된 스크립트 JSON 파일을 읽어 장면 데이터를 복원한다.
 */
async function readProjectScriptFile(projectPayload) {
  if (typeof projectPayload.scriptFilePath !== "string" || !projectPayload.scriptFilePath.trim()) {
    throw new Error("프로젝트 대표 파일에 스크립트 파일 정보가 없습니다.");
  }

  if (typeof projectPayload.projectFolderName !== "string" || !projectPayload.projectFolderName.trim()) {
    throw new Error("프로젝트 대표 파일에 프로젝트 폴더 정보가 없습니다.");
  }

  const scriptFileResponse = await window.fetch(
    createProjectAssetWebPath(projectPayload.projectFolderName, projectPayload.scriptFilePath)
  );

  if (!scriptFileResponse.ok) {
    throw new Error("프로젝트에 연결된 스크립트 파일을 읽지 못했습니다.");
  }

  const scriptPayload = await scriptFileResponse.json();
  return validateProjectFilePayload(scriptPayload);
}

/**
 * 프로젝트 대표 파일의 이미지 참조 정보를 장면 데이터에 합친다.
 */
function mergeProjectImageState(sceneItems, projectPayload) {
  const imageItems = Array.isArray(projectPayload.images) ? projectPayload.images : [];
  const videoItems = Array.isArray(projectPayload.videos) ? projectPayload.videos : [];

  return sceneItems.map((sceneItem, sceneIndex) => {
    const matchedImageItem = imageItems.find((imageItem) => imageItem?.sceneIndex === sceneIndex);
    const matchedVideoItem = videoItems.find((videoItem) => videoItem?.sceneIndex === sceneIndex);

    const nextSceneItem = { ...sceneItem };

    if (matchedImageItem && typeof matchedImageItem.filePath === "string" && matchedImageItem.filePath.trim()) {
      nextSceneItem.imageStatus = "success";
      nextSceneItem.generatedImagePath = matchedImageItem.filePath;
      nextSceneItem.generatedImageWebPath = createProjectAssetWebPath(
        projectPayload.projectFolderName,
        matchedImageItem.filePath
      );
    }

    if (matchedVideoItem && typeof matchedVideoItem.filePath === "string" && matchedVideoItem.filePath.trim()) {
      nextSceneItem.videoStatus = "success";
      nextSceneItem.generatedVideoWebPath = createProjectAssetWebPath(
        projectPayload.projectFolderName,
        matchedVideoItem.filePath
      );
    }

    return normalizeSceneItem(nextSceneItem);
  });
}

/**
 * 선택한 JSON이 프로젝트 대표 파일인지 스크립트 전용 파일인지 구분한다.
 */
function detectProjectFileKind(projectPayload) {
  if (!projectPayload || typeof projectPayload !== "object") {
    return "unknown";
  }

  if (typeof projectPayload.scriptFilePath === "string") {
    return "project-state";
  }

  const sceneItems = Array.isArray(projectPayload.scenes) ? projectPayload.scenes : [];
  const hasEmbeddedImageState = sceneItems.some(
    (sceneItem) =>
      typeof sceneItem?.generatedImagePath === "string" ||
      typeof sceneItem?.generatedImageWebPath === "string" ||
      typeof sceneItem?.imageStatus === "string"
  );

  const hasEmbeddedVideoState = sceneItems.some(
    (sceneItem) =>
      typeof sceneItem?.generatedVideoWebPath === "string" ||
      typeof sceneItem?.videoStatus === "string"
  );

  return hasEmbeddedImageState || hasEmbeddedVideoState ? "legacy-project-state" : "script-only";
}

/**
 * 현재 스크립트 탭의 카드 마크업에서 장면 데이터를 읽어 초기 상태를 맞춘다.
 */
function collectScenesFromMarkup() {
  if (!sceneCardList) {
    return [];
  }

  const sceneCardElements = sceneCardList.querySelectorAll(".scene-card");

  return Array.from(sceneCardElements, (sceneCardElement) => {
    const summaryText = sceneCardElement.querySelector(".scene-column:first-of-type .scene-text-box p")?.textContent?.trim() || "";
    const narrationText = sceneCardElement.querySelector(".scene-column:nth-of-type(2) .scene-text-box p")?.textContent?.trim() || "";
    const durationText = sceneCardElement.querySelector(".duration-box")?.textContent?.trim() || "";
    const durationMatch = durationText.match(/\d+/);

    return {
      summary: summaryText,
      narration: narrationText,
      durationSeconds: durationMatch ? Number.parseInt(durationMatch[0], 10) : 0,
      imagePrompt: "",
      videoPrompt: "",
    };
  }).filter((sceneItem) => sceneItem.summary);
}

/**
 * 프로젝트 상태와 장면 데이터를 화면 입력값, 카드, 결과 상태에 반영한다.
 */
function restoreProjectToScreen(projectPayload, sceneItems, options = {}) {
  const normalizedProjectPayload = projectPayload && typeof projectPayload === "object" ? projectPayload : {};
  const projectFolderName = typeof normalizedProjectPayload.projectFolderName === "string"
    ? normalizedProjectPayload.projectFolderName
    : "";
  const projectId = typeof normalizedProjectPayload.projectId === "string"
    ? normalizedProjectPayload.projectId
    : "";
  const mergedSceneItems = mergeProjectDbSceneResults(
    sceneItems,
    projectFolderName,
    Array.isArray(options.sceneResults) ? options.sceneResults : []
  );
  const fallbackProjectName = typeof options.fallbackProjectName === "string" ? options.fallbackProjectName : "";
  const projectName = typeof normalizedProjectPayload.projectTopic === "string" && normalizedProjectPayload.projectTopic.trim()
    ? normalizedProjectPayload.projectTopic.trim()
    : fallbackProjectName;

  syncScriptSettingsFromProject(normalizedProjectPayload);
  syncCurrentProjectInfo(projectName, projectFolderName, projectId);
  renderSceneCards(mergedSceneItems);
  activateTab("script");

  setSceneStatus(
    options.message || `${projectName || "선택한"} 프로젝트의 장면 ${mergedSceneItems.length}개와 이미지·영상 상태를 불러왔습니다.`,
    options.status || "success"
  );
}

/**
 * 사용자가 선택한 프로젝트 파일을 읽어 장면 카드와 입력값을 복원한다.
 */
async function importProjectFile(fileObject) {
  if (!(fileObject instanceof File)) {
    return;
  }

  setSceneStatus("저장된 프로젝트 파일을 불러오는 중입니다...", "loading");

  try {
    const rawFileText = await fileObject.text();
    let projectPayload = null;

    try {
      projectPayload = rawFileText ? JSON.parse(rawFileText) : null;
    } catch (error) {
      throw new Error("JSON 형식의 프로젝트 파일만 불러올 수 있습니다.");
    }

    const projectFileKind = detectProjectFileKind(projectPayload);
    const fileSceneItems = projectFileKind === "project-state"
      ? mergeProjectImageState(await readProjectScriptFile(projectPayload), projectPayload)
      : validateProjectFilePayload(projectPayload);
    const dbSceneResults = await fetchProjectSceneResults(projectPayload.projectFolderName, projectPayload.projectId);
    const projectName = typeof projectPayload.projectTopic === "string" && projectPayload.projectTopic.trim()
      ? projectPayload.projectTopic.trim()
      : fileObject.name;
    const hasRestorableMediaState = projectFileKind === "project-state" || projectFileKind === "legacy-project-state";

    restoreProjectToScreen(projectPayload, fileSceneItems, {
      fallbackProjectName: projectName,
      sceneResults: dbSceneResults,
      message: hasRestorableMediaState
        ? `${projectName} 프로젝트의 장면 ${fileSceneItems.length}개와 이미지·영상 상태를 불러왔습니다.`
        : `${projectName} 스크립트 파일을 불러왔습니다. 이 파일에는 이미지·영상 복원 상태가 없어 탭은 기본 상태로 표시됩니다.`,
      status: hasRestorableMediaState ? "success" : "loading",
    });
  } catch (error) {
    setSceneStatus(
      error instanceof Error ? error.message : "프로젝트 파일을 불러오지 못했습니다.",
      "error"
    );
  }
}

/**
 * 서버 DB 목록에서 선택한 프로젝트를 읽어 장면 카드와 입력값을 복원한다.
 */
async function importServerProject(projectFolderName, projectId) {
  const normalizedProjectFolderName = String(projectFolderName || "").trim();
  const normalizedProjectId = String(projectId || "").trim();

  if (!normalizedProjectFolderName && !normalizedProjectId) {
    return;
  }

  setSceneStatus("서버에 저장된 프로젝트를 불러오는 중입니다...", "loading");
  setProjectListStatus("프로젝트를 불러오는 중입니다...", "loading");

  try {
    const queryParams = new URLSearchParams();
    if (normalizedProjectId) {
      queryParams.set("projectId", normalizedProjectId);
    }
    if (normalizedProjectFolderName) {
      queryParams.set("projectFolderName", normalizedProjectFolderName);
    }

    const response = await window.fetch(`/api/project?${queryParams.toString()}`);
    const responseData = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(responseData.error || "프로젝트를 불러오지 못했습니다.");
    }

    const projectPayload = responseData.projectState && typeof responseData.projectState === "object"
      ? responseData.projectState
      : {};
    const scriptPayload = responseData.script && typeof responseData.script === "object"
      ? responseData.script
      : {};
    const projectItem = responseData.project && typeof responseData.project === "object" ? responseData.project : {};
    const scriptSceneItems = validateProjectFilePayload(scriptPayload);
    const fileSceneItems = mergeProjectImageState(scriptSceneItems, projectPayload);
    const projectName = typeof projectItem.name === "string" && projectItem.name.trim()
      ? projectItem.name.trim()
      : normalizedProjectFolderName;

    restoreProjectToScreen(
      {
        ...scriptPayload,
        ...projectPayload,
        projectId: projectPayload.projectId || projectItem.projectId || normalizedProjectId,
        projectTopic: projectPayload.projectTopic || projectItem.topic || projectName,
        projectFolderName: projectPayload.projectFolderName || projectItem.folderName || normalizedProjectFolderName,
        tone: projectPayload.tone || projectItem.tone || scriptPayload.tone || "",
        style: projectPayload.style || projectItem.style || scriptPayload.style || "",
        sceneCount: projectPayload.sceneCount || projectItem.sceneCount || scriptSceneItems.length,
      },
      fileSceneItems,
      {
        fallbackProjectName: projectName,
        sceneResults: Array.isArray(responseData.sceneResults) ? responseData.sceneResults : [],
        message: `${projectName} 프로젝트의 장면 ${scriptSceneItems.length}개와 이미지·영상 상태를 불러왔습니다.`,
        status: "success",
      }
    );
    closeProjectListModal();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.";
    setProjectListStatus(errorMessage, "error");
    setSceneStatus(errorMessage, "error");
  }
}

/**
 * 장면 데이터를 현재 화면 카드 마크업으로 다시 그린다.
 */
function renderSceneCards(sceneItems) {
  if (!sceneCardList) {
    return;
  }

  latestGeneratedScenes = sceneItems.map((sceneItem) => normalizeSceneItem(sceneItem));

  sceneCardList.innerHTML = sceneItems
    .map((sceneItem, index) => {
      const sceneNumber = String(index + 1).padStart(2, "0");

      return `
        <article class="scene-card">
          <div class="scene-card__top">
            <span class="scene-badge">SCENE ${sceneNumber}</span>
            <div class="scene-meta">
              <section class="scene-column">
                <h3 class="scene-column__title">한글 설명</h3>
                <div class="scene-text-box scene-text-box--scroll">
                  <p>${escapeHtml(sceneItem.summary)}</p>
                </div>
              </section>
              <section class="scene-column">
                <h3 class="scene-column__title">한글 나레이션</h3>
                <div class="scene-text-box">
                  <p>${escapeHtml(sceneItem.narration)}</p>
                </div>
              </section>
              <section class="scene-duration">
                <h3 class="scene-column__title">영상 길이</h3>
                <div class="duration-box">${sceneItem.durationSeconds}초</div>
              </section>
            </div>
          </div>
          <div class="scene-card__actions">
            <button type="button" class="scene-action scene-action--edit">편집</button>
            <button type="button" class="scene-action scene-action--retry">재생성</button>
            <button type="button" class="scene-action scene-action--delete">삭제</button>
          </div>
        </article>
      `;
    })
    .join("");

  renderImageSceneCards(latestGeneratedScenes);
  renderVideoSceneCards(latestGeneratedScenes);
}

/**
 * 이미지 카드 미리보기 영역 마크업을 현재 상태에 맞춰 반환한다.
 */
function renderImagePreviewMarkup(sceneItem, sceneOrderLabel) {
  if (sceneItem.imageStatus === "loading") {
    return `
      <div class="image-preview image-preview--loading" aria-label="${sceneOrderLabel} 장면 이미지 생성 중">
        <span class="image-preview__loading-spinner" aria-hidden="true"></span>
        <p class="image-preview__loading-text">이미지를 생성하고 있습니다.</p>
      </div>
    `;
  }

  if (sceneItem.generatedImageDataUrl || sceneItem.generatedImageWebPath) {
    return `
      <div class="image-preview" aria-label="${sceneOrderLabel} 장면 생성 이미지">
        <img
          class="image-preview__image"
          src="${sceneItem.generatedImageDataUrl || sceneItem.generatedImageWebPath}"
          alt="${escapeHtml(sceneItem.summary)}"
        />
      </div>
    `;
  }

  if (sceneItem.imageStatus === "error") {
    return `
      <div class="image-preview image-preview--empty image-preview--error" aria-label="${sceneOrderLabel} 장면 이미지 생성 실패">
        <span class="image-preview__placeholder-icon" aria-hidden="true">!</span>
        <p class="image-preview__placeholder-text">${escapeHtml(sceneItem.imageError || "이미지 생성에 실패했습니다.")}</p>
      </div>
    `;
  }

  return `
    <div class="image-preview image-preview--empty" aria-label="${sceneOrderLabel} 장면 이미지 없음">
      <span class="image-preview__placeholder-icon" aria-hidden="true">⌲</span>
      <p class="image-preview__placeholder-text">이미지가 생성되지 않았습니다.</p>
    </div>
  `;
}

/**
 * 장면 데이터를 이미지 탭 카드 마크업으로 다시 그린다.
 */
function renderImageSceneCards(sceneItems) {
  if (!imageSceneRail) {
    return;
  }

  imageSceneRail.innerHTML = sceneItems
    .map((sceneItem, index) => {
      const sceneNumber = String(index + 1).padStart(2, "0");
      const sceneOrderLabel = getSceneOrderLabel(index);

      return `
        <article class="image-scene-card${sceneItem.imageStatus === "loading" ? " is-loading" : ""}">
          <div class="image-scene-card__header">
            <span class="image-scene-badge">SCENE ${sceneNumber}</span>
          </div>
          <p class="image-scene-card__description">${escapeHtml(sceneItem.summary)}</p>
          ${renderImagePreviewMarkup(sceneItem, sceneOrderLabel)}
          <div class="image-scene-card__actions" aria-label="${sceneOrderLabel} 장면 이미지 버튼">
            <button
              type="button"
              class="image-action-button image-action-button--primary"
              data-image-generate-button
              data-scene-index="${index}"
              ${sceneItem.imageStatus === "loading" ? "disabled" : ""}
            >
              ${sceneItem.imageStatus === "loading" ? "생성 중..." : "✦ 이미지 생성"}
            </button>
            <button type="button" class="image-action-button image-action-button--icon" aria-label="${sceneOrderLabel} 장면 다시 불러오기">↻</button>
            <button type="button" class="image-action-button image-action-button--icon" aria-label="${sceneOrderLabel} 장면 다운로드">↓</button>
          </div>
          ${sceneItem.generatedImagePath ? `<p class="image-scene-card__saved-path">${escapeHtml(sceneItem.generatedImagePath)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

/**
 * 비디오 카드 미리보기 영역 마크업을 현재 상태에 맞춰 반환한다.
 */
function renderVideoPreviewMarkup(sceneItem, sceneOrderLabel) {
  if (sceneItem.videoStatus === "loading") {
    return `
      <div class="video-preview video-preview--loading" aria-label="${sceneOrderLabel} 장면 영상 생성 중">
        <span class="video-preview__loading-spinner" aria-hidden="true"></span>
        <p class="video-preview__loading-text">영상을 생성하고 있습니다.</p>
      </div>
    `;
  }

  if (sceneItem.generatedVideoWebPath) {
    return `
      <div class="video-preview video-preview--result" aria-label="${sceneOrderLabel} 장면 생성 영상">
        <video class="video-preview__player" src="${sceneItem.generatedVideoWebPath}" controls preload="metadata"></video>
      </div>
    `;
  }

  if (sceneItem.videoStatus === "error") {
    return `
      <div class="video-preview video-preview--empty video-preview--error" aria-label="${sceneOrderLabel} 장면 영상 생성 실패">
        <span class="video-preview__placeholder-icon" aria-hidden="true">!</span>
        <p class="video-preview__placeholder-text">${escapeHtml(sceneItem.videoError || "영상 생성에 실패했습니다.")}</p>
      </div>
    `;
  }

  return `
    <div class="video-preview video-preview--empty" aria-label="${sceneOrderLabel} 장면 영상 없음">
      <div class="video-preview__chrome" aria-hidden="true">
        <span class="video-preview__play-icon">▶</span>
        <span class="video-preview__timeline"></span>
        <span class="video-preview__timecode">0:00 / 0:05</span>
      </div>
      <span class="video-preview__placeholder-icon" aria-hidden="true">▷</span>
      <p class="video-preview__placeholder-text">영상이 생성되지 않았습니다.</p>
    </div>
  `;
}

/**
 * 장면 데이터를 비디오 탭 카드 마크업으로 다시 그린다.
 */
function renderVideoSceneCards(sceneItems) {
  if (!videoSceneRail) {
    return;
  }

  videoSceneRail.innerHTML = sceneItems
    .map((sceneItem, index) => {
      const sceneNumber = String(index + 1).padStart(2, "0");
      const sceneOrderLabel = getSceneOrderLabel(index);

      return `
        <article class="video-scene-card${sceneItem.videoStatus === "loading" ? " is-loading" : ""}">
          <div class="video-scene-card__header">
            <span class="video-scene-badge">SCENE ${sceneNumber}</span>
          </div>
          <p class="video-scene-card__description">${escapeHtml(sceneItem.summary)}</p>
          ${renderVideoPreviewMarkup(sceneItem, sceneOrderLabel)}
          <div class="video-scene-card__actions" aria-label="${sceneOrderLabel} 장면 영상 버튼">
            <button
              type="button"
              class="video-action-button video-action-button--primary"
              data-video-generate-button
              data-scene-index="${index}"
              ${sceneItem.videoStatus === "loading" ? "disabled" : ""}
            >
              ${sceneItem.videoStatus === "loading" ? "생성 중..." : "✦ 영상 생성"}
            </button>
            <button type="button" class="video-action-button video-action-button--icon" aria-label="${sceneOrderLabel} 장면 다시 생성">↻</button>
            <button type="button" class="video-action-button video-action-button--icon" aria-label="${sceneOrderLabel} 장면 다운로드">↓</button>
          </div>
        </article>
      `;
    })
    .join("");
}

/**
 * 사용자 입력을 안전하게 HTML 텍스트로 변환한다.
 */
function escapeHtml(textValue) {
  return String(textValue)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 특정 장면의 영상을 EvoLink Kling API로 생성하고 카드 상태를 갱신한다.
 */
async function generateVideoForScene(sceneIndex) {
  const sceneItem = latestGeneratedScenes[sceneIndex];
  const apiKeySettings = readStoredApiKeySettings();
  const activeTopic = currentProjectInfo.topic || (topicInput ? topicInput.value.trim() : "");
  const sourceImagePath = sceneItem?.generatedImagePath || "";

  if (!sceneItem) {
    return;
  }

  if (!sceneItem.videoPrompt) {
    updateSceneVideoState(sceneIndex, {
      videoStatus: "error",
      videoError: "영상 생성용 프롬프트가 아직 없습니다. 먼저 스크립트를 생성해 주세요.",
      generatedVideoWebPath: "",
    });
    activateTab("video");
    return;
  }

  if (!sourceImagePath) {
    updateSceneVideoState(sceneIndex, {
      videoStatus: "error",
      videoError: "먼저 이 장면의 이미지를 생성해 주세요.",
      generatedVideoWebPath: "",
    });
    activateTab("video");
    return;
  }

  if (!activeTopic) {
    updateSceneVideoState(sceneIndex, {
      videoStatus: "error",
      videoError: "프로젝트 주제를 확인할 수 없습니다. 먼저 스크립트를 생성하거나 프로젝트를 불러와 주세요.",
      generatedVideoWebPath: "",
    });
    return;
  }

  if (!apiKeySettings.klingApiKey) {
    setSceneStatus("EvoLink.AI API 키를 먼저 설정해 주세요.", "error");
    openApiKeyModal();
    return;
  }

  syncCurrentProjectInfo(activeTopic, currentProjectInfo.folderName, currentProjectInfo.projectId);
  updateSceneVideoState(sceneIndex, {
    videoStatus: "loading",
    videoError: "",
  });

  try {
    const response = await window.fetch("/api/video/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: activeTopic,
        projectId: currentProjectInfo.projectId,
        projectFolderName: currentProjectInfo.folderName,
        sceneIndex,
        videoPrompt: sceneItem.videoPrompt,
        sourceImagePath,
        klingApiKey: apiKeySettings.klingApiKey,
      }),
    });

    const rawResponseText = await response.text();
    let responseData = {};

    try {
      responseData = rawResponseText ? JSON.parse(rawResponseText) : {};
    } catch (error) {
      throw new Error(rawResponseText || "영상 생성 응답을 읽지 못했습니다.");
    }

    if (!response.ok) {
      const failedProjectId = responseData.projectId ? `프로젝트 ${responseData.projectId}` : "현재 프로젝트";
      const failedSceneNumber = Number.isInteger(responseData.sceneIndex) ? responseData.sceneIndex + 1 : sceneIndex + 1;
      throw new Error(`${failedProjectId} SCENE ${String(failedSceneNumber).padStart(2, "0")} 영상 생성 실패: ${responseData.error || "영상 생성에 실패했습니다."}`);
    }

    const generatedVideoWebPath = typeof responseData.video?.dbUrl === "string"
      ? responseData.video.dbUrl
      : typeof responseData.video?.webPath === "string"
        ? responseData.video.webPath
        : "";

    if (!generatedVideoWebPath) {
      throw new Error("생성된 영상 URL을 읽지 못했습니다.");
    }

    if (responseData.project) {
      syncCurrentProjectInfo(
        activeTopic,
        typeof responseData.project.folderName === "string" ? responseData.project.folderName : currentProjectInfo.folderName,
        typeof responseData.project.projectId === "string" ? responseData.project.projectId : currentProjectInfo.projectId
      );
    }

    updateSceneVideoState(sceneIndex, {
      videoStatus: "success",
      videoError: "",
      generatedVideoWebPath,
    });

    setSceneStatus(`SCENE ${String(sceneIndex + 1).padStart(2, "0")} 영상 생성을 완료했습니다.`, "success");
  } catch (error) {
    updateSceneVideoState(sceneIndex, {
      videoStatus: "error",
      videoError: error instanceof Error ? error.message : "영상 생성에 실패했습니다.",
      generatedVideoWebPath: "",
    });
  }
}

/**
 * 특정 장면의 이미지를 OpenAI API로 생성하고 카드 상태를 갱신한다.
 */
async function generateImageForScene(sceneIndex) {
  const sceneItem = latestGeneratedScenes[sceneIndex];
  const apiKeySettings = readStoredApiKeySettings();
  const activeTopic = currentProjectInfo.topic || (topicInput ? topicInput.value.trim() : "");

  if (!sceneItem) {
    return;
  }

  if (!sceneItem.imagePrompt) {
    updateSceneImageState(sceneIndex, {
      imageStatus: "error",
      imageError: "이미지 생성용 프롬프트가 아직 없습니다. 먼저 스크립트를 생성해 주세요.",
      generatedImageDataUrl: "",
      generatedImagePath: "",
    });
    activateTab("image");
    return;
  }

  if (!activeTopic) {
    updateSceneImageState(sceneIndex, {
      imageStatus: "error",
      imageError: "프로젝트 주제를 확인할 수 없습니다. 먼저 스크립트를 생성하거나 프로젝트를 불러와 주세요.",
      generatedImageDataUrl: "",
      generatedImagePath: "",
    });
    return;
  }

  if (!apiKeySettings.openaiApiKey) {
    setSceneStatus("OpenAI API 키를 먼저 설정해 주세요.", "error");
    openApiKeyModal();
    return;
  }

  syncCurrentProjectInfo(activeTopic, currentProjectInfo.folderName, currentProjectInfo.projectId);
  updateSceneImageState(sceneIndex, {
    imageStatus: "loading",
    imageError: "",
  });

  try {
    const response = await window.fetch("/api/image/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: activeTopic,
        projectId: currentProjectInfo.projectId,
        projectFolderName: currentProjectInfo.folderName,
        sceneIndex,
        imagePrompt: sceneItem.imagePrompt,
        openaiApiKey: apiKeySettings.openaiApiKey,
      }),
    });

    const rawResponseText = await response.text();
    let responseData = {};

    try {
      responseData = rawResponseText ? JSON.parse(rawResponseText) : {};
    } catch (error) {
      throw new Error(rawResponseText || "이미지 생성 응답을 읽지 못했습니다.");
    }

    if (!response.ok) {
      const failedProjectId = responseData.projectId ? `프로젝트 ${responseData.projectId}` : "현재 프로젝트";
      const failedSceneNumber = Number.isInteger(responseData.sceneIndex) ? responseData.sceneIndex + 1 : sceneIndex + 1;
      throw new Error(`${failedProjectId} SCENE ${String(failedSceneNumber).padStart(2, "0")} 이미지 생성 실패: ${responseData.error || "이미지 생성에 실패했습니다."}`);
    }

    const generatedImagePath = typeof responseData.image?.filePath === "string" ? responseData.image.filePath : "";
    const generatedImageWebPath = typeof responseData.image?.dbUrl === "string"
      ? responseData.image.dbUrl
      : typeof responseData.image?.webPath === "string"
        ? responseData.image.webPath
        : "";

    if (!generatedImageWebPath) {
      throw new Error("생성된 이미지 URL을 읽지 못했습니다.");
    }

    if (responseData.project) {
      syncCurrentProjectInfo(
        activeTopic,
        typeof responseData.project.folderName === "string" ? responseData.project.folderName : currentProjectInfo.folderName,
        typeof responseData.project.projectId === "string" ? responseData.project.projectId : currentProjectInfo.projectId
      );
    }

    updateSceneImageState(sceneIndex, {
      imageStatus: "success",
      imageError: "",
      generatedImageDataUrl: "",
      generatedImagePath,
      generatedImageWebPath,
    });

    setSceneStatus(`SCENE ${String(sceneIndex + 1).padStart(2, "0")} 이미지 생성을 완료했습니다.`, "success");
  } catch (error) {
    updateSceneImageState(sceneIndex, {
      imageStatus: "error",
      imageError: error instanceof Error ? error.message : "이미지 생성에 실패했습니다.",
      generatedImageDataUrl: "",
      generatedImagePath: "",
    });
  }
}

/**
 * OpenAI API 기반 장면 스크립트 생성을 요청하고 결과 카드를 갱신한다.
 */
async function generateScenesFromApi() {
  const apiKeySettings = readStoredApiKeySettings();
  const scriptPayload = getScriptGenerationPayload();

  if (!scriptPayload.topic) {
    setSceneStatus("영상 주제를 먼저 입력해 주세요.", "error");
    topicInput?.focus();
    return;
  }

  if (!apiKeySettings.openaiApiKey) {
    setSceneStatus("OpenAI API 키를 먼저 설정해 주세요.", "error");
    openApiKeyModal();
    return;
  }

  setGenerateButtonLoading(true);
  setSceneStatus("장면 스크립트를 생성하고 있습니다...", "loading");

  try {
    const response = await window.fetch("/api/script/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...scriptPayload,
        openaiApiKey: apiKeySettings.openaiApiKey,
      }),
    });

    const rawResponseText = await response.text();
    let responseData = {};

    try {
      responseData = rawResponseText ? JSON.parse(rawResponseText) : {};
    } catch (error) {
      throw new Error(rawResponseText || "스크립트 생성 응답을 읽지 못했습니다.");
    }

    if (!response.ok) {
      throw new Error(responseData.error || "스크립트 생성에 실패했습니다.");
    }

    const generatedScenes = Array.isArray(responseData.scenes) ? responseData.scenes : [];
    syncCurrentProjectInfo(
      scriptPayload.topic,
      typeof responseData.project?.folderName === "string" ? responseData.project.folderName : "",
      typeof responseData.project?.projectId === "string" ? responseData.project.projectId : ""
    );
    renderSceneCards(generatedScenes);
    setSceneStatus(`${generatedScenes.length}개의 장면 스크립트를 생성했습니다.`, "success");
  } catch (error) {
    setSceneStatus(error instanceof Error ? error.message : "스크립트 생성에 실패했습니다.", "error");
  } finally {
    setGenerateButtonLoading(false);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
  });
});

if (topicInput) {
  topicInput.addEventListener("input", () => {
    syncTopicCount();
    syncCurrentProjectInfo(topicInput.value);
  });
  syncTopicCount();
}

stepperButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!sceneCountInput) {
      return;
    }

    const currentValue = clampSceneCount(sceneCountInput.value);
    const nextValue = button.dataset.stepperAction === "increase" ? currentValue + 1 : currentValue - 1;

    syncSceneCount(nextValue);
  });
});

if (sceneCountInput) {
  sceneCountInput.addEventListener("input", () => {
    syncSceneCount(sceneCountInput.value);
  });

  sceneCountInput.addEventListener("blur", () => {
    syncSceneCount(sceneCountInput.value);
  });

  syncSceneCount(sceneCountInput.value);
}

if (generateScriptButton) {
  generateScriptButton.addEventListener("click", () => {
    generateScenesFromApi();
  });
}

if (imageSceneRail) {
  imageSceneRail.addEventListener("click", (event) => {
    const generateButton = event.target instanceof HTMLElement
      ? event.target.closest("[data-image-generate-button]")
      : null;

    if (!generateButton) {
      return;
    }

    const sceneIndex = Number.parseInt(generateButton.dataset.sceneIndex || "", 10);

    if (Number.isNaN(sceneIndex)) {
      return;
    }

    generateImageForScene(sceneIndex);
  });
}

if (videoSceneRail) {
  videoSceneRail.addEventListener("click", (event) => {
    const generateButton = event.target instanceof HTMLElement
      ? event.target.closest("[data-video-generate-button]")
      : null;

    if (!generateButton) {
      return;
    }

    const sceneIndex = Number.parseInt(generateButton.dataset.sceneIndex || "", 10);

    if (Number.isNaN(sceneIndex)) {
      return;
    }

    generateVideoForScene(sceneIndex);
  });
}

if (openProjectFileButton) {
  openProjectFileButton.addEventListener("click", () => {
    openProjectListModal();
  });
}

if (projectList) {
  projectList.addEventListener("click", (event) => {
    const projectButton = event.target instanceof HTMLElement
      ? event.target.closest("[data-project-folder-name]")
      : null;

    if (!projectButton) {
      return;
    }

    importServerProject(projectButton.dataset.projectFolderName, projectButton.dataset.projectId);
  });
}

closeProjectListModalButtons.forEach((button) => {
  button.addEventListener("click", closeProjectListModal);
});

if (openApiKeyModalButton) {
  openApiKeyModalButton.addEventListener("click", openApiKeyModal);
}

closeApiModalButtons.forEach((button) => {
  button.addEventListener("click", closeApiKeyModal);
});

if (apiKeyForm) {
  apiKeyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveApiKeySettings();
    closeApiKeyModal();
  });
}

apiKeyVisibilityButtons.forEach((button) => {
  button.addEventListener("click", () => {
    toggleApiKeyVisibility(button);
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && apiKeyModal && !apiKeyModal.hidden) {
    closeApiKeyModal();
  }
});

latestGeneratedScenes = collectScenesFromMarkup().map((sceneItem) => normalizeSceneItem(sceneItem));
renderImageSceneCards(latestGeneratedScenes);
renderVideoSceneCards(latestGeneratedScenes);
activateTab("script");

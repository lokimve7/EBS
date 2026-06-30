const tabButtons = document.querySelectorAll("[data-tab-target]");
const contentPanels = document.querySelectorAll("[data-tab-panel]");
const topicInput = document.querySelector("#topic-input");
const topicCount = document.querySelector("#topic-count");
const sceneCountInput = document.querySelector("#scene-count-input");
const stepperButtons = document.querySelectorAll("[data-stepper-action]");
const generateScriptButton = document.querySelector("#generate-script-button");
const generateButtonLabel = document.querySelector(".generate-button__label");
const openApiKeyModalButton = document.querySelector("#open-api-key-modal-button");
const apiKeyModal = document.querySelector("#api-key-modal");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyInputElements = document.querySelectorAll("[data-api-key-input]");
const closeApiModalButtons = document.querySelectorAll("[data-close-api-modal]");
const apiKeyVisibilityButtons = document.querySelectorAll("[data-toggle-api-visibility]");
const apiKeyStorageKey = "ebsApiKeySettings";
let generateButtonTimeoutId = null;
let lastFocusedElement = null;

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
 * 스크립트 생성 버튼을 잠시 진행 중 상태로 바꿔 화면 반응을 보여준다.
 */
function startGenerateButtonLoading() {
  if (!generateScriptButton || !generateButtonLabel) {
    return;
  }

  if (generateButtonTimeoutId) {
    window.clearTimeout(generateButtonTimeoutId);
  }

  generateScriptButton.disabled = true;
  generateScriptButton.classList.add("is-loading");
  generateButtonLabel.textContent = "생성 중...";

  generateButtonTimeoutId = window.setTimeout(() => {
    generateScriptButton.disabled = false;
    generateScriptButton.classList.remove("is-loading");
    generateButtonLabel.textContent = "스크립트 생성";
    generateButtonTimeoutId = null;
  }, 1600);
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

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
  });
});

if (topicInput) {
  topicInput.addEventListener("input", syncTopicCount);
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
  generateScriptButton.addEventListener("click", startGenerateButtonLoading);
}

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

activateTab("script");

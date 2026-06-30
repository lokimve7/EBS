const tabButtons = document.querySelectorAll("[data-tab-target]");
const contentPanels = document.querySelectorAll("[data-tab-panel]");
const topicInput = document.querySelector("#topic-input");
const topicCount = document.querySelector("#topic-count");
const sceneCountInput = document.querySelector("#scene-count-input");
const stepperButtons = document.querySelectorAll("[data-stepper-action]");
const generateScriptButton = document.querySelector("#generate-script-button");
const generateButtonLabel = document.querySelector(".generate-button__label");
const sceneCardList = document.querySelector("#scene-card-list");
const sceneStatusBanner = document.querySelector("#scene-status-banner");
const openApiKeyModalButton = document.querySelector("#open-api-key-modal-button");
const apiKeyModal = document.querySelector("#api-key-modal");
const apiKeyForm = document.querySelector("#api-key-form");
const apiKeyInputElements = document.querySelectorAll("[data-api-key-input]");
const closeApiModalButtons = document.querySelectorAll("[data-close-api-modal]");
const apiKeyVisibilityButtons = document.querySelectorAll("[data-toggle-api-visibility]");
const apiKeyStorageKey = "ebsApiKeySettings";
let lastFocusedElement = null;
let latestGeneratedScenes = [];

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
 * 장면 데이터를 현재 화면 카드 마크업으로 다시 그린다.
 */
function renderSceneCards(sceneItems) {
  if (!sceneCardList) {
    return;
  }

  latestGeneratedScenes = sceneItems.map((sceneItem) => ({ ...sceneItem }));

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
  generateScriptButton.addEventListener("click", () => {
    generateScenesFromApi();
  });
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

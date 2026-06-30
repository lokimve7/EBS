const tabButtons = document.querySelectorAll("[data-tab-target]");
const contentPanels = document.querySelectorAll("[data-tab-panel]");
const topicInput = document.querySelector("#topic-input");
const topicCount = document.querySelector("#topic-count");
const sceneCountInput = document.querySelector("#scene-count-input");
const stepperButtons = document.querySelectorAll("[data-stepper-action]");
const generateScriptButton = document.querySelector("#generate-script-button");
const generateButtonLabel = document.querySelector(".generate-button__label");
let generateButtonTimeoutId = null;

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

activateTab("script");

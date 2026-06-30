const http = require("http");
const fs = require("fs");
const https = require("https");
const path = require("path");

const PORT = 3001;
const HOST = "localhost";
const publicDirectory = path.join(__dirname, "public");
const indexFilePath = path.join(publicDirectory, "index.html");
const openAiApiHost = "api.openai.com";
const openAiResponsesPath = "/v1/responses";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};
const supportedDurations = [3, 4, 5];
let scriptRequestSequence = 0;

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

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fileContent);
  });
}

/**
 * 정적 파일 경로를 읽어 응답한다.
 */
function serveStaticFile(filePath, response) {
  const fileExtension = path.extname(filePath).toLowerCase();
  const contentType = contentTypes[fileExtension] || "application/octet-stream";

  fs.readFile(filePath, (error, fileContent) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("페이지를 찾을 수 없습니다.");
      return;
    }

    response.writeHead(200, { "Content-Type": contentType });
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
    logServerEvent(`[스크립트 생성 ${requestId}] 응답 반환 완료`, {
      sceneCount: sceneItems.length,
    });

    sendJson(response, 200, { scenes: sceneItems });
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
 * 요청 경로에 따라 기본 응답을 분기한다.
 */
function handleRequest(request, response) {
  const requestPath = request.url.split("?")[0];

  if (request.method === "POST" && requestPath === "/api/script/generate") {
    handleGenerateScriptRequest(request, response);
    return;
  }

  if (requestPath === "/") {
    serveWelcomePage(response);
    return;
  }

  const normalizedRequestPath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDirectory, normalizedRequestPath);

  if (filePath.startsWith(publicDirectory)) {
    serveStaticFile(filePath, response);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("페이지를 찾을 수 없습니다.");
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`서버가 실행되었습니다: http://${HOST}:${PORT}`);
});

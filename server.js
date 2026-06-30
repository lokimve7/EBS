const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3001;
const HOST = "localhost";
const publicDirectory = path.join(__dirname, "public");
const indexFilePath = path.join(publicDirectory, "index.html");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

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
 * 요청 경로에 따라 기본 응답을 분기한다.
 */
function handleRequest(request, response) {
  if (request.url === "/") {
    serveWelcomePage(response);
    return;
  }

  const requestPath = request.url.split("?")[0];
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

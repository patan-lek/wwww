import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import { isSavedWordList } from "../src/domain/validation";
import type { SavedWord } from "../src/domain/vocabulary";

const API_PATH = "/api/vocabulary";
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const databasePath = resolve(process.cwd(), ".local-data", "vocabulary.json");
let pendingWrite: Promise<void> = Promise.resolve();

async function readDatabase(): Promise<{ words: SavedWord[]; hasFile: boolean }> {
  try {
    const file = await readFile(databasePath, "utf8");
    const words: unknown = JSON.parse(file);

    if (!isSavedWordList(words)) {
      throw new Error("Local vocabulary file has an invalid format.");
    }

    return { words, hasFile: true };
  } catch (error) {
    if (isFileNotFound(error)) return { words: [], hasFile: false };
    throw error;
  }
}

async function writeDatabase(words: SavedWord[]): Promise<void> {
  await mkdir(dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(words, null, 2)}\n`, "utf8");
  await rename(temporaryPath, databasePath);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error("Request body exceeds the 10 MB limit.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) {
  if (new URL(request.url ?? "/", "http://localhost").pathname !== API_PATH) {
    next();
    return;
  }

  try {
    const clientAddress = request.socket.remoteAddress ?? "";
    const isLocalClient =
      clientAddress === "127.0.0.1" ||
      clientAddress === "::1" ||
      clientAddress === "::ffff:127.0.0.1";
    if (!isLocalClient) {
      sendJson(response, 403, { error: "Vocabulary storage is available only to this computer." });
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, await readDatabase());
      return;
    }

    if (request.method !== "PUT") {
      response.setHeader("Allow", "GET, PUT");
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const payload = await readRequestBody(request);
    if (!isSavedWordList(payload)) {
      sendJson(response, 400, { error: "Invalid vocabulary data." });
      return;
    }

    const words = payload as SavedWord[];
    const write = pendingWrite.then(() => writeDatabase(words));
    pendingWrite = write.catch(() => undefined);
    await write;
    sendJson(response, 200, { words });
  } catch (error) {
    const isInvalidJson = error instanceof SyntaxError;
    sendJson(response, isInvalidJson ? 400 : 500, {
      error:
        error instanceof Error ? error.message : "Could not access local vocabulary storage.",
    });
  }
}

export function localVocabularyApi(): Plugin {
  return {
    name: "wwww-local-vocabulary-api",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleRequest(request, response, next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void handleRequest(request, response, next);
      });
    },
  };
}

import type { DictionaryEntry, SavedWord } from "../domain/vocabulary";
import { isSavedWordList } from "../domain/validation";
import { normalizeLookupTerm } from "./translation/tsvDictionaryProvider";

const API_URL = "/api/vocabulary";
const LEGACY_STORAGE_KEY = "wwww.saved-words.v1";

interface VocabularyResponse {
  words: SavedWord[];
  hasFile?: boolean;
}

async function request<T>(method: "GET" | "PUT", body?: SavedWord[]): Promise<T> {
  const response = await fetch(API_URL, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : "The local vocabulary file could not be accessed.";
    throw new Error(message);
  }

  return payload as T;
}

export async function loadSavedWords(): Promise<SavedWord[]> {
  const localFile = await request<VocabularyResponse>("GET");

  if (localFile.hasFile) {
    removeLegacyStorage();
    return localFile.words;
  }

  const legacyWords = readLegacyStorage();
  if (legacyWords.length === 0) {
    removeLegacyStorage();
    return [];
  }

  const migratedFile = await persist(legacyWords);
  removeLegacyStorage();
  return migratedFile;
}

export async function saveSuccessfulLookup(
  savedWords: SavedWord[],
  entry: DictionaryEntry,
  timestamp = new Date().toISOString(),
): Promise<SavedWord[]> {
  const normalizedWord = normalizeLookupTerm(entry.word);
  const existingIndex = savedWords.findIndex(
    (word) => normalizeLookupTerm(word.word) === normalizedWord,
  );

  const nextWords = [...savedWords];
  if (existingIndex >= 0) {
    const existingWord = nextWords[existingIndex];
    nextWords[existingIndex] = {
      ...existingWord,
      ...entry,
      highlighted: existingWord.highlighted,
      lookupTimestamps: [...existingWord.lookupTimestamps, timestamp],
    };
  } else {
    nextWords.unshift({
      ...entry,
      highlighted: false,
      lookupTimestamps: [timestamp],
    });
  }

  return persist(nextWords);
}

export async function toggleHighlight(
  savedWords: SavedWord[],
  targetWord: string,
): Promise<SavedWord[]> {
  const nextWords = savedWords.map((word) =>
    normalizeLookupTerm(word.word) === normalizeLookupTerm(targetWord)
      ? { ...word, highlighted: !word.highlighted }
      : word,
  );

  return persist(nextWords);
}

export async function restoreSavedWords(
  savedWords: SavedWord[],
  backup: string,
): Promise<SavedWord[]> {
  const parsed: unknown = JSON.parse(backup);
  if (!isSavedWordList(parsed)) {
    throw new Error("The selected file is not a valid wwww vocabulary backup.");
  }

  const mergedWords = [...savedWords];
  for (const importedWord of parsed) {
    const existingIndex = mergedWords.findIndex(
      (word) => normalizeLookupTerm(word.word) === normalizeLookupTerm(importedWord.word),
    );

    if (existingIndex < 0) {
      mergedWords.push(importedWord);
      continue;
    }

    const existingWord = mergedWords[existingIndex];
    mergedWords[existingIndex] = {
      ...existingWord,
      ...importedWord,
      highlighted: existingWord.highlighted || importedWord.highlighted,
      lookupTimestamps: [
        ...existingWord.lookupTimestamps,
        ...importedWord.lookupTimestamps,
      ].sort(),
    };
  }

  return persist(mergedWords);
}

async function persist(words: SavedWord[]): Promise<SavedWord[]> {
  const response = await request<VocabularyResponse>("PUT", words);
  return response.words;
}

function readLegacyStorage(): SavedWord[] {
  try {
    const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyData) return [];

    const parsed: unknown = JSON.parse(legacyData);
    return isSavedWordList(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function removeLegacyStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Migration is best-effort when browser storage is unavailable.
  }
}

import type { SavedWord } from "./vocabulary";

export function isSavedWord(value: unknown): value is SavedWord {
  if (!value || typeof value !== "object") return false;

  const word = value as Partial<SavedWord>;
  return (
    typeof word.word === "string" &&
    Array.isArray(word.meanings) &&
    word.meanings.every(
      (meaning) =>
        typeof meaning?.partOfSpeech === "string" &&
        typeof meaning?.thai === "string",
    ) &&
    Array.isArray(word.relatedWords) &&
    word.relatedWords.every((relatedWord) => typeof relatedWord === "string") &&
    Array.isArray(word.synonyms) &&
    word.synonyms.every((synonym) => typeof synonym === "string") &&
    Array.isArray(word.antonyms) &&
    word.antonyms.every((antonym) => typeof antonym === "string") &&
    Array.isArray(word.lookupTimestamps) &&
    word.lookupTimestamps.every(
      (timestamp) =>
        typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)),
    ) &&
    typeof word.highlighted === "boolean"
  );
}

export function isSavedWordList(value: unknown): value is SavedWord[] {
  return Array.isArray(value) && value.every(isSavedWord);
}

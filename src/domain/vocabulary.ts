export interface Meaning {
  partOfSpeech: string;
  thai: string;
}

export interface DictionaryEntry {
  word: string;
  meanings: Meaning[];
  relatedWords: string[];
  synonyms: string[];
  antonyms: string[];
}

export interface SavedWord extends DictionaryEntry {
  /** ISO timestamps for every successful lookup, including repeats. */
  lookupTimestamps: string[];
  highlighted: boolean;
}

export interface TranslationProvider {
  lookup(term: string): Promise<DictionaryEntry | null>;
}

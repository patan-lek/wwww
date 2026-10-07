import type {
  DictionaryEntry,
  Meaning,
  TranslationProvider,
} from "../../domain/vocabulary";

const datasetUrl = new URL(
  "../../dataset/words-eng-th/dataset_eng-th.tsv",
  import.meta.url,
).href;

interface DatasetRow {
  searchTerm: string;
  entry: string;
  thai: string;
  category: string;
  relatedThai: string;
  synonyms: string;
  antonyms: string;
}

let rowsPromise: Promise<DatasetRow[]> | undefined;
let indexPromise: Promise<Map<string, DatasetRow[]>> | undefined;

export function normalizeLookupTerm(term: string): string {
  return term.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function parseTsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        const afterEscapedQuote = text[index + 2];
        if (
          field.length === 0 &&
          (afterEscapedQuote === "\t" ||
            afterEscapedQuote === "\n" ||
            afterEscapedQuote === undefined)
        ) {
          inQuotes = false;
        } else {
          field += '"';
          index += 1;
        }
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === "\t") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }

  return records;
}

function parseDataset(text: string): DatasetRow[] {
  const [header, ...records] = parseTsv(text);
  const requiredColumns = ["e-search", "e-entry", "t-entry", "e-cat", "t-related", "e-syn", "e-ant"];
  const columns = new Map(header.map((name, index) => [name, index]));

  if (requiredColumns.some((name) => !columns.has(name))) {
    throw new Error("The English–Thai dataset is missing required columns.");
  }

  const get = (record: string[], column: string) =>
    record[columns.get(column)!]?.trim() ?? "";

  return records
    .filter((record) => record.length >= header.length)
    .map((record) => ({
      searchTerm: get(record, "e-search"),
      entry: get(record, "e-entry"),
      thai: get(record, "t-entry"),
      category: get(record, "e-cat"),
      relatedThai: get(record, "t-related"),
      synonyms: get(record, "e-syn"),
      antonyms: get(record, "e-ant"),
    }))
    .filter((row) => row.searchTerm && row.thai);
}

async function loadRows(): Promise<DatasetRow[]> {
  if (!rowsPromise) {
    rowsPromise = fetch(datasetUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load the dictionary (HTTP ${response.status}).`);
      }

      return parseDataset(await response.text());
    });
  }

  try {
    return await rowsPromise;
  } catch (error) {
    rowsPromise = undefined;
    throw error;
  }
}

async function loadIndex(): Promise<Map<string, DatasetRow[]>> {
  if (!indexPromise) {
    indexPromise = loadRows().then((rows) => {
      const index = new Map<string, DatasetRow[]>();

      for (const row of rows) {
        const keys = new Set([
          normalizeLookupTerm(row.searchTerm),
          normalizeLookupTerm(row.entry),
        ]);

        for (const key of keys) {
          if (!key) continue;
          const matches = index.get(key) ?? [];
          matches.push(row);
          index.set(key, matches);
        }
      }

      return index;
    }).catch((error: unknown) => {
      indexPromise = undefined;
      throw error;
    });
  }

  return indexPromise;
}

function getPartOfSpeech(category: string): string {
  const normalized = category.trim().toUpperCase();
  const commonCategories: Record<string, string> = {
    N: "noun",
    NPL: "noun",
    V: "verb",
    VT: "verb",
    VI: "verb",
    ADJ: "adjective",
    ADV: "adverb",
    PREP: "preposition",
    PERP: "preposition",
    CONJ: "conjunction",
    DET: "determiner",
    DM: "determiner",
    ART: "article",
    PRON: "pronoun",
    PRO: "pronoun",
    AUX: "auxiliary verb",
    ABBR: "abbreviation",
    INT: "interjection",
    INTER: "interjection",
    PHRV: "phrasal verb",
    IDM: "idiom",
    SL: "slang",
    PRF: "prefix",
    SUF: "suffix",
  };

  const categories = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => commonCategories[part] ?? part.toLocaleLowerCase("en-US"));

  if (categories.length > 0) return [...new Set(categories)].join(" / ");

  return "other";
}

function splitTerms(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((term) => term.trim())
    .filter((term) => term && term !== '""');
}

function getMeaningSortPriority(partOfSpeech: string): number {
  const normalized = partOfSpeech.toLocaleLowerCase("en-US");
  if (normalized === "noun") return 0;
  if (normalized === "verb") return 1;
  if (normalized === "slang") return 3;
  return 2;
}

function getEverydayMeaningLength(thai: string): number {
  const everydayMeaning = thai.split(" · ", 1)[0].trim();
  return [...everydayMeaning].length;
}

function getThaiMeaning(row: DatasetRow): string {
  const primaryMeaning = row.thai;
  if (getPartOfSpeech(row.category) !== "noun") return primaryMeaning;

  // Prefer a concise everyday equivalent when the dataset provides one.
  const everydayEquivalent = splitTerms(row.relatedThai).find(
    (term) => [...term].length <= 12 && !/[()]/.test(term),
  );

  if (!everydayEquivalent || everydayEquivalent === primaryMeaning) {
    return primaryMeaning;
  }

  return `${everydayEquivalent} · ${primaryMeaning}`;
}

function toDictionaryEntry(term: string, matches: DatasetRow[]): DictionaryEntry {
  const entryName = matches.find((row) => row.entry)?.entry || term;
  const meanings = new Map<string, Meaning>();

  for (const row of matches) {
    const meaning = {
      partOfSpeech: getPartOfSpeech(row.category),
      thai: getThaiMeaning(row),
    };
    meanings.set(`${meaning.partOfSpeech}\u0000${meaning.thai}`, meaning);
  }

  const sortedMeanings = [...meanings.values()].sort((first, second) => {
    const partPriority =
      getMeaningSortPriority(first.partOfSpeech) -
      getMeaningSortPriority(second.partOfSpeech);
    if (partPriority !== 0) return partPriority;

    // Compare the everyday equivalent before its formal dictionary definition.
    // This puts "หมา" ahead of longer senses such as "ตะแกรงเหล็ก" for "dog".
    return getEverydayMeaningLength(first.thai) - getEverydayMeaningLength(second.thai);
  });

  return {
    word: entryName,
    meanings: sortedMeanings,
    relatedWords: [...new Set(matches.flatMap((row) => splitTerms(row.relatedThai)))],
    synonyms: [...new Set(matches.flatMap((row) => splitTerms(row.synonyms)))],
    antonyms: [...new Set(matches.flatMap((row) => splitTerms(row.antonyms)))],
  };
}

export function createTsvDictionaryProvider(): TranslationProvider {
  return {
    async lookup(term) {
      const normalizedTerm = normalizeLookupTerm(term);
      if (!normalizedTerm) return null;

      const index = await loadIndex();
      const matches = index.get(normalizedTerm) ?? [];

      return matches.length ? toDictionaryEntry(normalizedTerm, matches) : null;
    },
  };
}

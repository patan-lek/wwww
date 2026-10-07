import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumn,
  Check,
  Flame,
  Search,
  Sparkles,
  Star,
  Volume2,
} from "lucide-react";

import type { SavedWord } from "../domain/vocabulary";
import {
  loadSavedWords,
  restoreSavedWords,
  saveSuccessfulLookup,
  toggleHighlight,
} from "../services/vocabularyStorage";
import { createTsvDictionaryProvider, normalizeLookupTerm } from "../services/translation/tsvDictionaryProvider";

type Page = "Discover" | "My Words" | "Insights";

const nav = [
  { name: "Discover" as Page, icon: Sparkles },
  { name: "My Words" as Page, icon: BookOpen },
  { name: "Insights" as Page, icon: ChartNoAxesColumn },
];

const dictionary = createTsvDictionaryProvider();
const frequentLookupThreshold = 3;
const bangkokTimezone = "Asia/Bangkok";

function say(word: string) {
  if (!("speechSynthesis" in window)) return;

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

function getBangkokDateKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: bangkokTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function getLookupCount(word: SavedWord): number {
  return word.lookupTimestamps.length;
}

export default function Home() {
  const [page, setPage] = useState<Page>("Discover");
  const [words, setWords] = useState<SavedWord[]>([]);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState("All");
  const [partFilter, setPartFilter] = useState("All parts of speech");
  const [find, setFind] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [isStorageLoading, setIsStorageLoading] = useState(true);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    loadSavedWords()
      .then((savedWords) => {
        if (!cancelled) setWords(savedWords);
      })
      .catch(() => {
        if (!cancelled) {
          setNotice("อ่านไฟล์ข้อมูลในเครื่องไม่สำเร็จ กรุณาตรวจสอบว่าแอปกำลังรันผ่าน pnpm dev");
        }
      })
      .finally(() => {
        if (!cancelled) setIsStorageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const current = words.find(
    (word) => normalizeLookupTerm(word.word) === selectedWord,
  );
  const partOfSpeechOptions = useMemo(
    () => [...new Set(words.flatMap((word) => word.meanings.map((meaning) => meaning.partOfSpeech)))].sort(),
    [words],
  );
  const filtered = words.filter((word) => {
    const matchesSearch = normalizeLookupTerm(word.word).includes(normalizeLookupTerm(find));
    const matchesFlag =
      filter === "All" ||
      (filter === "Highlighted" && word.highlighted) ||
      (filter === "Frequent" && getLookupCount(word) >= frequentLookupThreshold);
    const matchesPart =
      partFilter === "All parts of speech" ||
      word.meanings.some((meaning) => meaning.partOfSpeech === partFilter);

    return matchesSearch && matchesFlag && matchesPart;
  });

  const analytics = useMemo(() => {
    const todayKey = getBangkokDateKey(new Date());
    const currentMonth = todayKey.slice(0, 7);
    const allLookups = words.flatMap((word) =>
      word.lookupTimestamps.map((timestamp) => ({ word: word.word, timestamp })),
    );
    const topWords = [...words]
      .sort((first, second) => getLookupCount(second) - getLookupCount(first))
      .slice(0, 5);
    const partOfSpeechCounts = [...new Set(
      words.flatMap((word) => word.meanings.map((meaning) => meaning.partOfSpeech)),
    )]
      .map((partOfSpeech) => ({
        partOfSpeech,
        count: words.filter((word) =>
          word.meanings.some((meaning) => meaning.partOfSpeech === partOfSpeech),
        ).length,
      }))
      .sort((first, second) => second.count - first.count);

    return {
      today: words.filter(
        (word) => getBangkokDateKey(word.lookupTimestamps[0]) === todayKey,
      ).length,
      month: words.filter(
        (word) => getBangkokDateKey(word.lookupTimestamps[0]).startsWith(currentMonth),
      ).length,
      allTime: words.length,
      totalLookups: allLookups.length,
      repeatLookups: Math.max(0, allLookups.length - words.length),
      topWords,
      partOfSpeechCounts,
    };
  }, [words]);

  function showStorageError() {
    setNotice("บันทึกไฟล์ข้อมูลในเครื่องไม่สำเร็จ โปรดลองอีกครั้ง");
  }

  async function translate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = normalizeLookupTerm(input);

    if (!term) {
      setNotice("กรุณาพิมพ์คำภาษาอังกฤษก่อนค้นหา");
      return;
    }
    if (!/^[a-z][a-z .'-]*$/i.test(term)) {
      setNotice("กรุณาใช้ตัวอักษรภาษาอังกฤษในการค้นหา");
      return;
    }

    setIsLoading(true);
    setNotice("");

    try {
      const translation = await dictionary.lookup(term);
      if (!translation) {
        setNotice(`ไม่พบ “${term}” ในพจนานุกรมภาษาอังกฤษ-ไทยชุดนี้`);
        return;
      }

      const savedWords = await saveSuccessfulLookup(words, translation);
      setWords(savedWords);
      setSelectedWord(normalizeLookupTerm(translation.word));
      setInput("");
    } catch {
      setNotice("โหลดพจนานุกรมหรือบันทึกคำไม่สำเร็จ โปรดลองอีกครั้ง");
    } finally {
      setIsLoading(false);
    }
  }

  async function mark(word: string) {
    try {
      const updatedWords = await toggleHighlight(words, word);
      setWords(updatedWords);
    } catch {
      showStorageError();
    }
  }

  function open(word: string) {
    setSelectedWord(normalizeLookupTerm(word));
    setPage("Discover");
    window.scrollTo(0, 0);
  }

  function exportBackup() {
    const backup = new Blob([JSON.stringify(words, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wwww-vocabulary-${getBangkokDateKey(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupNotice("ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว");
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const backupText = await file.text();
      const restoredWords = await restoreSavedWords(words, backupText);
      setWords(restoredWords);
      setBackupNotice("นำเข้าข้อมูลสำรองและรวมกับคำศัพท์เดิมแล้ว");
    } catch {
      setBackupNotice("อ่านไฟล์สำรองไม่สำเร็จ ไฟล์ต้องเป็น JSON สำรองของ wwww");
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">
            w<span>w</span>
          </span>
          <b>wwww</b>
        </div>
        <small className="side-label">WORKSPACE</small>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              onClick={() => setPage(name)}
              className={page === name ? "active" : ""}
              aria-current={page === name ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "My Words" && <em>{words.length}</em>}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="account">
            <span>W</span>
            <div>
              <b>My workspace</b>
              <small>Saved in project file</small>
            </div>
          </div>
        </div>
      </aside>

      <main>
        <header className="top">
          <span>
            Workspace <i>/</i> <b>{page}</b>
          </span>
          <div>
            <small>LOCAL DICTIONARY</small>
            <span>W</span>
          </div>
        </header>

        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">
                <i />
                {page === "Discover"
                  ? "YOUR VOCABULARY SPACE"
                  : page === "My Words"
                    ? "YOUR COLLECTION"
                    : "YOUR LEARNING JOURNEY"}
              </div>
              <h1>
                {page === "Discover" ? "Discover a word" : page}
                <span>.</span>
              </h1>
              <p>
                {page === "Discover"
                  ? "ค้นหาคำภาษาอังกฤษจากพจนานุกรมที่เก็บไว้ในโปรเจกต์"
                  : page === "My Words"
                    ? "คำที่คุณค้นพบและบันทึกไว้บนอุปกรณ์นี้"
                    : "สรุปการค้นหาจากประวัติที่บันทึกไว้บนอุปกรณ์นี้"}
              </p>
            </div>
            <div className="heading-icon">
              <Sparkles size={26} />
            </div>
          </div>

          {page === "Discover" && (
            <>
              <form className="lookup" onSubmit={translate}>
                <Search size={22} aria-hidden="true" />
                <input
                  aria-label="English word"
                  placeholder="Type an English word, e.g. abandon"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={isLoading || isStorageLoading}
                />
                <button disabled={isLoading || isStorageLoading}>
                  {isStorageLoading
                    ? "Loading…"
                    : isLoading
                      ? "Looking up…"
                      : "Translate"}
                  <ArrowRight size={18} />
                </button>
              </form>
              {notice && (
                <div role="alert" className="notice">
                  {notice}
                </div>
              )}

              {isStorageLoading ? (
                <section className="empty-state" role="status">
                  <BookOpen size={28} />
                  <h2>Loading local vocabulary</h2>
                  <p>Reading your saved words from the project data file.</p>
                </section>
              ) : current ? (
                <div className="discovery">
                  <section className="definition">
                    <div className="meta">
                      <span>
                        <i /> WORD DISCOVERED
                      </span>
                      <span>{current.meanings.length} MEANINGS</span>
                    </div>
                    <div className="word-title">
                      <div>
                        <h2>{current.word}</h2>
                        <div className="ipa">
                          Pronunciation not included in this dataset
                          <button
                            aria-label={`Pronounce ${current.word}`}
                            onClick={() => say(current.word)}
                            type="button"
                          >
                            <Volume2 size={19} />
                          </button>
                        </div>
                      </div>
                      <button
                        aria-label={`${current.highlighted ? "Remove highlight from" : "Highlight"} ${current.word}`}
                        className={`star ${current.highlighted ? "marked" : ""}`}
                        onClick={() => mark(current.word)}
                        type="button"
                      >
                        <Star
                          size={23}
                          fill={current.highlighted ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                    <div className="meanings">
                      {current.meanings.map((meaning, index) => (
                        <div key={`${meaning.partOfSpeech}-${meaning.thai}-${index}`}>
                          <span>{meaning.partOfSpeech}</span>
                          <strong>{meaning.thai}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="example">
                      <small>✦ &nbsp; WORD DETAILS</small>
                      <blockquote>Example sentences are not included in this dataset.</blockquote>
                      {current.relatedWords.length > 0 && (
                        <p>คำที่เกี่ยวข้อง: {current.relatedWords.join(" · ")}</p>
                      )}
                    </div>
                    <footer>
                      <span>
                        <Check size={16} /> Saved in My Words
                      </span>
                      <span>
                        พบคำนี้แล้ว <b>{getLookupCount(current)} ครั้ง</b>
                      </span>
                    </footer>
                  </section>

                  <div className="side-cards">
                    <section className="card">
                      <div className="card-label">
                        <span className="purple">
                          <BookOpen size={19} />
                        </span>
                        RELATED WORDS
                      </div>
                      {current.synonyms.length > 0 ? (
                        current.synonyms.map((word) => (
                          <div className="family" key={word}>
                            <div>
                              <b>{word}</b>
                            </div>
                            <span>synonym</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">No related English words in this entry.</p>
                      )}
                      {current.antonyms.length > 0 && (
                        <p className="muted">Antonyms: {current.antonyms.join(" · ")}</p>
                      )}
                    </section>
                    <section className="card">
                      <div className="card-label">
                        <span className="orange">
                          <Flame size={19} />
                        </span>
                        YOUR CONNECTION
                      </div>
                      <h3>
                        {getLookupCount(current) >= frequentLookupThreshold
                          ? "Frequently found"
                          : "Building your vocabulary"}
                      </h3>
                      <p>
                        คุณค้นคำนี้ไปแล้ว <b>{getLookupCount(current)} ครั้ง</b>
                      </p>
                      <small className="muted">
                        {current.lookupTimestamps.length > 0
                          ? `Last found ${new Date(current.lookupTimestamps.at(-1)!).toLocaleString()}`
                          : "Lookup history is saved on this device."}
                      </small>
                    </section>
                  </div>
                </div>
              ) : (
                <section className="empty-state">
                  <BookOpen size={28} />
                  <h2>Your dictionary is ready</h2>
                  <p>Search a word to see its Thai definitions from the local dataset.</p>
                </section>
              )}

              <div className="section-heading">
                <div>
                  <h3>Recently discovered</h3>
                  <p>คำที่คุณค้นหาล่าสุด</p>
                </div>
                <button onClick={() => setPage("My Words")}>
                  View all words <ArrowRight size={17} />
                </button>
              </div>
              {words.length > 0 ? (
                <div className="recent">
                  {words.slice(0, 4).map((word) => (
                    <button key={word.word} onClick={() => open(word.word)}>
                      <span>{word.word[0]}</span>
                      <div>
                        <b>{word.word}</b>
                        <small>{word.meanings[0]?.thai ?? ""}</small>
                      </div>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">Your discovered words will appear here.</p>
              )}
            </>
          )}

          {page === "My Words" && (
            <>
              <div className="collection-controls">
                <label>
                  <Search size={18} aria-hidden="true" />
                  <input
                    aria-label="Search saved words"
                    placeholder="Search your words..."
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                  />
                </label>
                <div>
                  {["All", "Highlighted", "Frequent"].map((filterName) => (
                    <button
                      type="button"
                      className={filter === filterName ? "selected" : ""}
                      key={filterName}
                      onClick={() => setFilter(filterName)}
                    >
                      {filterName}
                    </button>
                  ))}
                </div>
                <label className="part-filter-label">
                  <span>Part of speech</span>
                  <select
                    value={partFilter}
                    onChange={(event) => setPartFilter(event.target.value)}
                    aria-label="Filter by part of speech"
                  >
                    <option>All parts of speech</option>
                    {partOfSpeechOptions.map((part) => (
                      <option key={part}>{part}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="collection-actions">
                <button type="button" onClick={exportBackup} disabled={words.length === 0}>
                  Export backup
                </button>
                <button type="button" onClick={() => backupInput.current?.click()}>
                  Import backup
                </button>
                <input
                  ref={backupInput}
                  type="file"
                  accept="application/json,.json"
                  onChange={importBackup}
                  aria-label="Choose a wwww backup file"
                  hidden
                />
                {backupNotice && <span role="status">{backupNotice}</span>}
              </div>
              <div className="table">
                <div className="table-header">
                  <span>WORD</span>
                  <span>MEANING</span>
                  <span>TYPE</span>
                  <span>FOUND</span>
                </div>
                {filtered.map((word) => (
                  <div className="table-row" key={word.word}>
                    <button
                      type="button"
                      className={`row-star ${word.highlighted ? "marked" : ""}`}
                      onClick={() => mark(word.word)}
                      aria-label={`${word.highlighted ? "Remove highlight from" : "Highlight"} ${word.word}`}
                    >
                      <Star
                        size={18}
                        fill={word.highlighted ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      className="row-word"
                      onClick={() => open(word.word)}
                    >
                      {word.word}
                    </button>
                    <span>{word.meanings[0]?.thai}</span>
                    <small>
                      {[...new Set(word.meanings.map((meaning) => meaning.partOfSpeech))].join(" / ")}
                    </small>
                    <b>
                      {getLookupCount(word)}× {getLookupCount(word) >= frequentLookupThreshold && <Flame size={15} />}
                    </b>
                    <button
                      type="button"
                      className="row-open"
                      onClick={() => open(word.word)}
                      aria-label={`Open ${word.word}`}
                    >
                      <ArrowRight size={17} />
                    </button>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <p className="empty">
                    {words.length === 0
                      ? "No words saved yet. Discover one from the dictionary."
                      : "ไม่พบคำที่ตรงกับการค้นหา"}
                  </p>
                )}
              </div>
            </>
          )}

          {page === "Insights" && (
            <>
              <div className="stats">
                {[
                  { label: "WORDS TODAY", value: analytics.today, sub: "คำที่ค้นพบวันนี้" },
                  { label: "THIS MONTH", value: analytics.month, sub: "คำใหม่เดือนนี้" },
                  { label: "ALL TIME", value: analytics.allTime, sub: "คำศัพท์ทั้งหมด" },
                  { label: "TOTAL LOOKUPS", value: analytics.totalLookups, sub: "จำนวนครั้งที่ค้นหา" },
                  { label: "REPEAT LOOKUPS", value: analytics.repeatLookups, sub: "ค้นคำเดิมซ้ำ" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <small>{stat.label}</small>
                    <strong>{stat.value}</strong>
                    <span>{stat.sub}</span>
                  </div>
                ))}
              </div>

              <div className="insights">
                <section className="card">
                  <h3>Vocabulary by part of speech</h3>
                  <p>จำนวนคำที่บันทึกไว้ในแต่ละประเภท</p>
                  {analytics.partOfSpeechCounts.length > 0 ? (
                    <div className="pos-breakdown">
                      {analytics.partOfSpeechCounts.map(({ partOfSpeech, count }) => {
                        const percent = (count / analytics.allTime) * 100;

                        return (
                          <div className="pos-breakdown-row" key={partOfSpeech}>
                            <div>
                              <span>{partOfSpeech}</span>
                              <strong>{count}</strong>
                            </div>
                            <div
                              className="pos-breakdown-track"
                              role="progressbar"
                              aria-label={`${partOfSpeech} words`}
                              aria-valuemin={0}
                              aria-valuemax={analytics.allTime}
                              aria-valuenow={count}
                            >
                              <span style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty">Save words to see your vocabulary mix.</p>
                  )}
                </section>
                <section className="card">
                  <h3>
                    Most searched words <Flame size={20} />
                  </h3>
                  <p>เรียงตามจำนวนครั้งที่ค้นหา</p>
                  {analytics.topWords.length > 0 ? (
                    <div className="ranking">
                      {analytics.topWords.map((word, index) => (
                        <button key={word.word} onClick={() => open(word.word)}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <b>{word.word}</b>
                          <i>
                            <em
                              style={{
                                width: `${(getLookupCount(word) / getLookupCount(analytics.topWords[0])) * 100}%`,
                              }}
                            />
                          </i>
                          <strong>{getLookupCount(word)}×</strong>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">Search a word to start your history.</p>
                  )}
                </section>
              </div>
              <p className="preview-note">
                Frequency starts at {frequentLookupThreshold} lookups. Your data is stored in this browser only.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

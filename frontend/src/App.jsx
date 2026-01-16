import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { downloadVideo, fetchInfo } from "./api";

const emptyState = {
  title: "",
  thumbnail: "",
  formats: [],
  duration: null,
};

const RECENT_KEY = "recentDownloads";

const translations = {
  en: {
    languageToggle: "EN / RU",
    eyebrow: "No-Storage Streamer",
    title: "Video Downloader",
    description: "Paste a link from YouTube, TikTok, or any yt-dlp supported source.",
    pastePlaceholder: "Paste a link...",
    video: "Video",
    audioOnly: "Audio Only (MP3)",
    paste: "Paste",
    getInfo: "Get Info",
    fetching: "Fetching...",
    noPreview: "No preview available",
    resultCard: "Result Card",
    duration: "Duration",
    size: "Size",
    audioOutput: "Audio Output",
    chooseQuality: "Choose Quality",
    converting: "Converting stream to MP3 on the fly...",
    selected: "Selected",
    videoTooLong: "Video is too long for instant server streaming.",
    preparing: "Preparing...",
    downloadMp3: "Download MP3",
    download: "Download",
    recentDownloads: "Recent Downloads",
    tapToReload: "Tap to reload",
    buyMeCoffee: "Buy Me a Coffee",
    supportDonate: "ЖМИ ЕСЛИ НЕ ГЕЙ",
    footer:
      "Streams are proxied directly from the source. No files are stored on the server.",
    errorPasteUrl: "Please paste a video URL.",
    errorFetch: "Failed to fetch video info.",
    errorClipboardUnsupported: "Clipboard access not supported.",
    successClipboard: "Pasted from clipboard.",
    errorClipboardRead: "Unable to read clipboard.",
    errorSelectQuality: "Please select a quality to download.",
    successDownload: "Download started:",
    errorDownload: "Download failed.",
  },
  ru: {
    languageToggle: "EN / RU",
    eyebrow: "Без хранения",
    title: "Скачивание Видео",
    description: "Вставьте ссылку из YouTube, TikTok или любого источника yt-dlp.",
    pastePlaceholder: "Вставьте ссылку...",
    video: "Видео",
    audioOnly: "Только Аудио",
    paste: "Вставить",
    getInfo: "Найти",
    fetching: "Поиск...",
    noPreview: "Превью недоступно",
    resultCard: "Результат",
    duration: "Длительность",
    size: "Размер",
    audioOutput: "Аудио",
    chooseQuality: "Качество",
    converting: "Конвертация...",
    selected: "Выбрано",
    videoTooLong: "Видео слишком длинное для мгновенной загрузки.",
    preparing: "Подготовка...",
    downloadMp3: "Скачать MP3",
    download: "Скачать",
    recentDownloads: "История",
    tapToReload: "Нажмите, чтобы повторить",
    buyMeCoffee: "Поддержать Автора",
    supportDonate: "SUPPORT / ДОНАТ",
    footer: "Потоки идут напрямую с источника. Файлы не хранятся на сервере.",
    errorPasteUrl: "Пожалуйста, вставьте ссылку.",
    errorFetch: "Не удалось получить информацию.",
    errorClipboardUnsupported: "Буфер обмена недоступен.",
    successClipboard: "Вставлено из буфера обмена.",
    errorClipboardRead: "Не удалось прочитать буфер обмена.",
    errorSelectQuality: "Выберите качество для загрузки.",
    successDownload: "Загрузка началась:",
    errorDownload: "Ошибка загрузки.",
  },
};

const formatBytes = (bytes) => {
  if (!bytes) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) {
    return "-";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function App() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState(emptyState);
  const [selectedFormat, setSelectedFormat] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mode, setMode] = useState("video");
  const [recent, setRecent] = useState([]);
  const [language, setLanguage] = useState("en");

  const t = (key) => translations[language]?.[key] ?? key;

  useEffect(() => {
    const saved = window.localStorage.getItem(RECENT_KEY);
    if (saved) {
      try {
        setRecent(JSON.parse(saved));
      } catch (error) {
        window.localStorage.removeItem(RECENT_KEY);
      }
    }
  }, []);

  const hasFormats = info.formats.length > 0;

  const selectedFormatInfo = useMemo(
    () => info.formats.find((format) => format.format_id === selectedFormat),
    [info.formats, selectedFormat]
  );

  const selectedLabel = selectedFormatInfo?.label || "";
  const sizeLabel = formatBytes(selectedFormatInfo?.filesize);
  const durationLabel = formatDuration(info.duration);
  const isTooLong = info.duration !== null && info.duration !== undefined && info.duration > 60 * 60;

  const persistRecent = (next) => {
    setRecent(next);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const addRecent = (entry) => {
    const filtered = recent.filter((item) => item.url !== entry.url);
    const next = [entry, ...filtered].slice(0, 5);
    persistRecent(next);
  };

  const handleFetch = async (overrideUrl) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl) {
      toast.error(t("errorPasteUrl"));
      return;
    }
    setLoadingInfo(true);
    setInfo(emptyState);
    setSelectedFormat("");
    try {
      const data = await fetchInfo(targetUrl);
      setInfo({ ...emptyState, ...data });
      if (data.formats.length) {
        setSelectedFormat(data.formats[0].format_id);
      }
      setUrl(targetUrl);
    } catch (err) {
      toast.error(err.message || t("errorFetch"));
    } finally {
      setLoadingInfo(false);
    }
  };

  const handlePaste = async () => {
    if (!navigator.clipboard?.readText) {
      toast.error(t("errorClipboardUnsupported"));
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      if (text) {
        toast.success(t("successClipboard"));
      }
    } catch (error) {
      toast.error(t("errorClipboardRead"));
    }
  };

  const handleDownload = async () => {
    if (mode === "video" && !selectedFormat) {
      toast.error(t("errorSelectQuality"));
      return;
    }
    if (!url) {
      toast.error(t("errorPasteUrl"));
      return;
    }
    setDownloading(true);
    try {
      const fileName = await downloadVideo({
        url,
        format_id: selectedFormat,
        mode,
      });
      toast.success(`${t("successDownload")} ${fileName}`);
      addRecent({ url, title: info.title || url, thumbnail: info.thumbnail });
    } catch (err) {
      toast.error(err.message || t("errorDownload"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream text-ink">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#FFF1C9",
            color: "#0F172A",
            border: "2px solid #0F172A",
            boxShadow: "4px 4px 0 0 #0F172A",
            fontWeight: 700,
          },
        }}
      />
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-4 py-12">
        <div className="relative w-full rounded-2xl border-2 border-ink bg-butter p-6 shadow-brutalPop md:p-10">
          <div className="mb-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.4em] text-pop">
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-black text-ink md:text-5xl">
              {t("title")}
            </h1>
            <p className="mt-3 text-sm font-semibold text-ink/80 md:text-base">
              {t("description")}
            </p>
          </div>

          <div className="mb-5 grid gap-3 rounded-xl border-2 border-ink bg-cream p-2 shadow-brutal">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {["video", "audio"].map((value) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`group flex-1 rounded-lg border-2 border-ink px-4 py-2 text-sm font-black uppercase tracking-wide transition active:translate-x-1 active:translate-y-1 active:shadow-none ${
                    mode === value
                      ? "bg-ink text-cream shadow-brutal"
                      : "bg-cream text-ink shadow-brutal hover:bg-pop/20"
                  }`}
                >
                  {value === "video" ? t("video") : t("audioOnly")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("pastePlaceholder")}
              className="flex-1 rounded-lg border-2 border-ink bg-cream px-4 py-3 text-sm font-semibold text-ink shadow-brutal outline-none placeholder:text-ink/50 focus:ring-2 focus:ring-pop"
            />
            <button
              onClick={handlePaste}
              className="rounded-lg border-2 border-ink bg-cream px-4 py-3 text-sm font-black uppercase text-ink shadow-brutal transition active:translate-x-1 active:translate-y-1 active:shadow-none"
            >
              {t("paste")}
            </button>
            <button
              onClick={() => handleFetch()}
              disabled={loadingInfo || !url}
              className="rounded-lg border-2 border-ink bg-ink px-6 py-3 text-sm font-black uppercase text-cream shadow-brutal transition active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingInfo ? t("fetching") : t("getInfo")}
            </button>
          </div>

          {loadingInfo && (
            <div className="mt-6 grid gap-4 rounded-2xl border-2 border-ink bg-cream p-6 shadow-brutal">
              <div className="h-32 w-full rounded-lg border-2 border-ink bg-butter" />
              <div className="h-4 w-2/3 rounded-lg border-2 border-ink bg-butter" />
              <div className="h-4 w-1/3 rounded-lg border-2 border-ink bg-butter" />
            </div>
          )}

          <AnimatePresence>
            {hasFormats && !loadingInfo && (
              <motion.div
                key="result-card"
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ type: "spring", stiffness: 220, damping: 18 }}
                className="mt-6 grid gap-6 md:grid-cols-[230px,1fr]"
              >
                <div className="overflow-hidden rounded-xl border-[3px] border-ink bg-cream shadow-brutal">
                  {info.thumbnail ? (
                    <img
                      src={info.thumbnail}
                      alt={info.title}
                      className="h-full w-full border-b-[3px] border-ink object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-6 text-xs font-semibold text-ink/70">
                      {t("noPreview")}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl border-[3px] border-ink bg-cream p-4 shadow-brutal">
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-ink/70">
                      {t("resultCard")}
                    </p>
                    <h2 className="mt-2 text-xl font-black text-ink md:text-2xl">{info.title}</h2>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-ink/80">
                      <span className="rounded-full border-2 border-ink bg-butter px-3 py-1">
                        {t("duration")}: {durationLabel}
                      </span>
                      <span className="rounded-full border-2 border-ink bg-butter px-3 py-1">
                        {t("size")}: {sizeLabel}
                      </span>
                      {mode === "video" && selectedLabel && (
                        <span className="rounded-full border-2 border-ink bg-butter px-3 py-1">
                          {selectedLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border-[3px] border-ink bg-cream p-4 shadow-brutal">
                    <label className="text-xs font-bold uppercase tracking-[0.3em] text-ink/70">
                      {mode === "audio" ? t("audioOutput") : t("chooseQuality")}
                    </label>
                    {mode === "audio" ? (
                      <p className="mt-3 text-sm font-semibold text-ink/80">
                        {t("converting")}
                      </p>
                    ) : (
                      <select
                        value={selectedFormat}
                        onChange={(event) => setSelectedFormat(event.target.value)}
                        className="mt-3 w-full rounded-lg border-2 border-ink bg-cream px-3 py-2 text-sm font-semibold text-ink shadow-brutal outline-none focus:ring-2 focus:ring-pop"
                      >
                        {info.formats.map((format) => (
                          <option key={format.format_id} value={format.format_id}>
                            {format.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {mode === "video" && (
                      <p className="mt-2 text-xs font-semibold text-ink/70">
                        {t("selected")}: <span className="text-pop">{selectedLabel || "-"}</span>
                      </p>
                    )}
                  </div>

                  {isTooLong && (
                    <div className="rounded-xl border-[3px] border-ink bg-pop/30 p-4 text-sm font-bold text-ink shadow-brutal">
                      {t("videoTooLong")}
                    </div>
                  )}

                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex items-center justify-center gap-3 rounded-lg border-[3px] border-ink bg-pop px-6 py-3 text-sm font-black uppercase text-ink shadow-brutal transition active:translate-x-1 active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {downloading && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
                    )}
                    {downloading ? t("preparing") : mode === "audio" ? t("downloadMp3") : t("download")}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {recent.length > 0 && (
            <div className="mt-8 rounded-2xl border-2 border-ink bg-cream p-5 shadow-brutal">
              <h3 className="text-xs font-black uppercase tracking-[0.3em] text-ink/70">
                {t("recentDownloads")}
              </h3>
              <div className="mt-4 grid w-full max-w-full grid-cols-1 gap-4 md:grid-cols-2">
                {recent.map((item) => (
                  <button
                    key={item.url}
                    onClick={() => handleFetch(item.url)}
                    className="relative flex items-center w-full p-3 border-2 border-black bg-cream shadow-hard overflow-hidden"
                  >
                    <div className="h-14 w-20 overflow-hidden rounded-lg border-2 border-ink bg-cream">
                      {item.thumbnail ? (
                        <img src={item.thumbnail} alt={item.title} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col ml-3">
                      <p className="font-bold text-sm text-black truncate w-full">{item.title}</p>
                      <p className="mt-1 text-xs font-semibold text-ink/70">{t("tapToReload")}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <a
          href="https://www.donationalerts.com/r/kwop"
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border-2 border-ink bg-yellow-300 px-4 py-2 text-sm font-black uppercase text-ink shadow-brutal transition active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          {t("supportDonate")}
        </a>

        <p className="mt-6 text-center text-xs font-semibold text-ink/70">
          {t("footer")}
        </p>
      </div>
    </div>
  );
}

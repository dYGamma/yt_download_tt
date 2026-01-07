import asyncio
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from typing import Any, AsyncGenerator, Dict, List, Optional
from urllib.parse import quote

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

app = FastAPI(title="No-Storage Video Downloader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INFO_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 600
YT_DLP_SOCKET_TIMEOUT = "30"
YT_DLP_PROCESS_TIMEOUT = 45
YT_DLP_UPDATE_INTERVAL_HOURS = 24

scheduler = BackgroundScheduler()


class InfoRequest(BaseModel):
    url: HttpUrl


class DownloadRequest(BaseModel):
    url: HttpUrl
    format_id: Optional[str] = None
    mode: str = "video"


def sanitize_filename(name: str, fallback: str = "video") -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "", normalized).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or fallback


def update_yt_dlp() -> None:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def get_yt_dlp_version() -> str:
    result = subprocess.run(
        ["yt-dlp", "--version"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    version = (result.stdout or "").strip()
    return version or "unknown"


def get_cached_info(url: str) -> Optional[Dict[str, Any]]:
    cached = INFO_CACHE.get(url)
    if not cached:
        return None
    if time.monotonic() - cached["timestamp"] > CACHE_TTL_SECONDS:
        INFO_CACHE.pop(url, None)
        return None
    return cached["data"]


def set_cached_info(url: str, data: Dict[str, Any]) -> None:
    INFO_CACHE[url] = {"timestamp": time.monotonic(), "data": data}


async def run_yt_dlp_json(url: str) -> Dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "--dump-json",
        "--socket-timeout",
        YT_DLP_SOCKET_TIMEOUT,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=YT_DLP_PROCESS_TIMEOUT)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.wait()
        raise HTTPException(status_code=408, detail="yt-dlp timed out while fetching info") from exc
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="ignore") or "Failed to fetch video info"
        raise HTTPException(status_code=400, detail=detail)
    return json.loads(stdout.decode("utf-8"))


def build_format_list(info: Dict[str, Any]) -> List[Dict[str, Any]]:
    formats = []
    for fmt in info.get("formats", []):
        format_id = fmt.get("format_id")
        if not format_id:
            continue
        height = fmt.get("height")
        vcodec = fmt.get("vcodec")
        if vcodec == "none":
            label = "Audio Only"
        elif height:
            label = f"{height}p"
        else:
            label = fmt.get("resolution") or fmt.get("format_note") or "Unknown"
        fps = fmt.get("fps")
        if fps:
            label += f" {fps}fps"
        ext = fmt.get("ext")
        if ext:
            label += f" ({ext})"
        formats.append(
            {
                "format_id": format_id,
                "label": label,
                "ext": ext,
                "filesize": fmt.get("filesize") or fmt.get("filesize_approx"),
                "height": height,
                "vcodec": vcodec,
                "acodec": fmt.get("acodec"),
                "mime_type": fmt.get("mime_type"),
            }
        )
    formats.sort(key=lambda f: (f.get("height") or 0, f.get("label") or ""), reverse=True)
    return formats


def find_format(info: Dict[str, Any], format_id: str) -> Dict[str, Any]:
    for fmt in info.get("formats", []):
        if fmt.get("format_id") == format_id:
            return fmt
    raise HTTPException(status_code=404, detail="Selected format not found")


async def get_info_data(url: str) -> Dict[str, Any]:
    cached = get_cached_info(url)
    if cached:
        return cached
    info = await run_yt_dlp_json(url)
    data = {
        "title": info.get("title"),
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "formats": build_format_list(info),
    }
    set_cached_info(url, data)
    return data


@app.post("/api/info")
async def get_info(payload: InfoRequest) -> Dict[str, Any]:
    return await get_info_data(str(payload.url))


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    return {"yt_dlp_version": get_yt_dlp_version()}


@app.post("/api/download")
async def download_video(payload: DownloadRequest) -> StreamingResponse:
    info = await run_yt_dlp_json(str(payload.url))
    title = sanitize_filename(info.get("title") or "video")
    mode = payload.mode.lower()

    if mode == "audio":
        filename = f"{title}.mp3"
        yt_process = await asyncio.create_subprocess_exec(
            "yt-dlp",
            "-f",
            "bestaudio",
            "-o",
            "-",
            "--socket-timeout",
            YT_DLP_SOCKET_TIMEOUT,
            str(payload.url),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        ffmpeg_process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-i",
            "pipe:0",
            "-vn",
            "-acodec",
            "libmp3lame",
            "-f",
            "mp3",
            "pipe:1",
            stdin=yt_process.stdout,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def stream() -> AsyncGenerator[bytes, None]:
            try:
                while True:
                    chunk = await ffmpeg_process.stdout.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
            finally:
                if ffmpeg_process.returncode is None:
                    ffmpeg_process.kill()
                if yt_process.returncode is None:
                    yt_process.kill()
                await ffmpeg_process.wait()
                await yt_process.wait()

        headers = {
            "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
            "X-Content-Type-Options": "nosniff",
        }
        return StreamingResponse(stream(), media_type="audio/mpeg", headers=headers)

    if not payload.format_id:
        raise HTTPException(status_code=400, detail="format_id is required for video downloads")

    selected_format = find_format(info, payload.format_id)
    ext = selected_format.get("ext") or info.get("ext") or "mp4"
    filename = f"{title}.{ext}"

    process = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "-f",
        payload.format_id,
        "-o",
        "-",
        "--socket-timeout",
        YT_DLP_SOCKET_TIMEOUT,
        str(payload.url),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def stream() -> AsyncGenerator[bytes, None]:
        try:
            while True:
                chunk = await process.stdout.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()

    mime_type = selected_format.get("mime_type")
    if mime_type and ";" in mime_type:
        mime_type = mime_type.split(";", 1)[0]
    content_type = mime_type or "application/octet-stream"

    headers = {
        "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
        "X-Content-Type-Options": "nosniff",
    }

    return StreamingResponse(stream(), media_type=content_type, headers=headers)


static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


@app.on_event("startup")
def start_scheduler() -> None:
    if not scheduler.running:
        scheduler.add_job(update_yt_dlp, "interval", hours=YT_DLP_UPDATE_INTERVAL_HOURS)
        scheduler.start()

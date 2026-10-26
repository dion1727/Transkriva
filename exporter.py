"""Ekspor transkrip tanpa dependensi mesin AI."""
from pathlib import Path
import json


def timestamp(seconds, separator=","):
    milliseconds = max(0, round(float(seconds) * 1000))
    seconds, ms = divmod(milliseconds, 1000)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f"{hours:02}:{minute:02}:{sec:02}{separator}{ms:03}"


def export_result(result, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    segments = result.get("segments", [])
    (destination / "transkrip.txt").write_text(result.get("text", "").strip() + "\n", encoding="utf-8")
    timed, srt = [], []
    for index, segment in enumerate(segments, 1):
        start, end = timestamp(segment["start"]), timestamp(segment["end"])
        text = segment["text"].strip()
        timed.append(f"[{start} - {end}] {text}")
        srt.append(f"{index}\n{start} --> {end}\n{text}\n")
    (destination / "transkrip_waktu.txt").write_text("\n".join(timed) + "\n", encoding="utf-8")
    (destination / "subtitle.srt").write_text("\n".join(srt), encoding="utf-8")
    (destination / "hasil.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

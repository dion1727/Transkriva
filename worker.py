"""Mesin transkripsi terpisah agar UI responsif dan proses dapat dihentikan."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import wave
from exporter import export_result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", choices=["tiny", "base", "small", "medium", "turbo"], default="medium")
    parser.add_argument("--language", choices=["id", "en", "auto"], default="id")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error("File audio tidak ditemukan.")
    import numpy as np
    import torch
    import whisper
    import imageio_ffmpeg
    device = ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA tidak tersedia. Pilih Otomatis atau CPU.")
    print(f"Perangkat: {torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU'}", flush=True)
    print("Mengonversi audio ke mono 16 kHz...", flush=True)
    with tempfile.TemporaryDirectory(prefix="audio-transcriber-") as directory:
        wav = Path(directory) / "audio.wav"
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(args.audio), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], check=True)
        with wave.open(str(wav), "rb") as source:
            samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    print(f"Memuat model {args.model}. Penggunaan pertama dapat mengunduh model...", flush=True)
    model = whisper.load_model(args.model, device=device)
    print("Transkripsi dimulai. Teks akan muncul per segmen...", flush=True)
    result = model.transcribe(samples, language=None if args.language == "auto" else args.language, fp16=device == "cuda", verbose=True)
    export_result(result, args.output)
    print(f"SELESAI: {args.output}", flush=True)


if __name__ == "__main__":
    main()

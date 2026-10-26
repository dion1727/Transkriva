# Security & Privacy Notes

Transkriva is designed for **local use only**. It is not hardened for deployment on a public server.

## Before publishing this repository

- Do **not** commit audio recordings, transcripts, exported subtitles, personal filenames, or local logs.
- Keep `uploads/`, `outputs/`, `*.log`, `.env`, local virtual environments, credentials, and model caches out of Git.
- Review `git status` and the full diff before every public Push.
- Screenshots in `docs/screenshots/` are sanitized examples. Do not replace them with private media or names.
- If secrets were previously committed, removing them from the latest commit is insufficient; rotate credentials and clean Git history if necessary.

## Runtime

- The server binds to `127.0.0.1:5000` by default and does not offer authentication.
- Files uploaded through the local UI persist under `uploads/`; exported results persist under `outputs/`. Delete them manually when no longer needed.
- The first Whisper model load may download model weights from the internet. This is separate from uploading user audio to a remote transcription service.
- Do not change binding to `0.0.0.0` or deploy the current server to the public internet without appropriate authentication, rate limiting, upload controls, and security review.

## Dependency note

Install packages in a virtual environment; prefer supported Python/PyTorch/CUDA combinations and update dependencies as needed.

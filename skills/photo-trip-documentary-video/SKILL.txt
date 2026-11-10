---
name: photo-trip-documentary-video
description: Turn a folder of trip photos and short clips (with GPS) into a professional 30-35 minute documentary film with music, AI narration in two languages (two audio tracks), two subtitle tracks, animated title/chapter/map cards, and a ready-to-upload YouTube package. Use when asked to "make a video from my trip photos", "create a documentary / slideshow with narration and music", or to add narration, subtitles, multi-language audio or a YouTube upload package to a photo video.
license: MIT
---

# Photo trip documentary video

End-to-end pipeline, proven on a 7-day trip (1,470 photos + 39 clips -> 31.5 min film, English + Russian narration,
EN + RU subtitles, 1080p). Works with any AI coding agent that can run shell commands, read images and edit files.
Scripts are in `scripts/` (Python + ffmpeg), animated cards in `remotion/` (React). Read `reference.md` BEFORE
starting: it lists the pitfalls that cost the most time (spoken prompts, click/noise bursts, colour/VLC, YouTube).

## Requirements
- ffmpeg 6+ (zoompan, xfade, drawtext, sidechaincompress, loudnorm, alimiter, zscale/tonemap), ffprobe
- Python 3.10+ with Pillow, pillow-heif, numpy, imagehash, google-genai; exiftool
- Node 20/22 + Remotion 4 for animated cards (optional; hybrid approach). On Windows ARM64 use an x64 Node build.
- A Gemini API key in the env var `GEMINI_API_KEY` (Google AI Studio). Never write it to a file or commit it.
  If a user pastes a key in chat, use it inline per command and tell them to rotate it afterwards.
- Set `TRIP_ROOT` to the project folder (contains `photos-and-videos/`; the scripts create `build/`). Other optional
  env vars: `EXIFTOOL`, `NODE_X64_DIR`, `VERSION`, `NAME`, `TITLE`.

## Decisions to confirm with the user first (ask once, briefly)
1. Length (default 30-35 min main cut; 45 min is possible but less dynamic).
2. Languages for narration audio and subtitles (two languages -> two audio tracks + two SRTs).
3. Use short video clips mixed with photos (default yes).
4. Voice/model. Default `gemini-3.8-flash-tts`, voice "Charon". Music: choose royalty-free tracks yourself
   (CC BY 4.0 Kevin MacLeod / incompetech) - credit is mandatory.
5. Where it will be published (YouTube needs a different package than local playback).

## Pipeline (run from the `scripts/` folder, one step at a time, check output after each)
1. `01_inventory.py` exiftool -> `build/inventory.json` (time, GPS, camera, size). Drop screenshots/tiny files.
2. `02_quality.py` sharpness (Laplacian variance with numpy), exposure, perceptual-hash dedupe of bursts -> `quality.json`.
3. `03_geocode.py` cluster by GPS+time into stops, Nominatim reverse geocode (1 req/s, cached). Landmarks come out
   wrong or as street names: confirm facts with web search; some phones embed wrong coordinates (check outliers).
4. `04_contactsheets.py` labelled contact sheets per stop. LOOK at them (read images) and pick the best ~200-250
   photos + 15-25 clip moments into `build/picks.txt`. Keep a mix of wide, detail, people, POV.
5. `05_storyboard.py` -> `storyboard.json` chapters/segments. Write the narration script per segment in each
   language (`06_script_EXAMPLE_uzbekistan.py` shows the format: chapters -> segments with labels, place names,
   `en`/`ru` text). Short, concrete, 1-3 sentences, only facts you verified; hedge uncertain identifications.
   Show the user the chapter list + sample narration for approval before generating audio.
6. Narration: `07b_tts_batch.py submit` then `... collect` (Gemini **Batch API**, avoids the 100 requests/day/model cap
   and is half price). `tts_lib.clean_pcm` removes the API's loud noise bursts. NEVER put style instructions in the
   text: the model reads them aloud. Then slow the clips ~8% (`atempo=0.92`) for a calm documentary pace.
   `12_stt_check.py` transcribes the start of clips to prove no prompt text is spoken.
7. `08_timeline.py` single shared timeline for both languages: segment length = max(narration in all languages) +
   1.0 s lead + 1.4 s tail, photos 8.5 s each, 0.6 s xfades; writes `timeline.json`, `subs_<lang>.srt` and the
   music plan (`PLAN` dict: one track per location/theme, edit it).
8. `09_video.py` renders every unit to `build/seg/*.mp4` (resumable): Ken-Burns pans on 1.1x plates, portrait photos
   on blurred backgrounds, HLG/HDR clips tone-mapped to SDR, all outputs tagged bt709 TV range, on-screen place
   name + short description (two languages) over a gradient. Cards/title/map/credits come from Remotion (`remotion/`).
9. `10_audio.py` mixes music (per-track loudness-normalised) + narration with sidechain ducking, loudnorm,
   alimiter (`level=0`!), one AAC file per language.
10. `11_concat.py` joins segments -> `video_all.mp4`; `14_package.py` builds `<VERSION>/` with: full MKV + MP4
    (2 audio, 2 subtitle tracks), sidecar `.srt` (UTF-8 **with BOM**, CRLF for Windows players), and `youtube/`:
    EN video (single audio), `Audio_<lang>.m4a`, plain-UTF-8 SRTs, fallback second-language video, README with credits.
11. Verify (see below), then give the user the YouTube steps from `reference.md`.

## Rules for every change
- Create a NEW version folder (`v1`, `v2`, ...); never overwrite the previous deliverables.
- If only audio changes, keep clip durations identical (silence bursts instead of trimming) so no video re-render is needed.
- Cache everything in `build/`; every step is resumable. Do not re-render segments unless their duration changed.
- Report faithfully what was and was not verified; you cannot hear audio or run every player - say so.

## Verification checklist
- `ffprobe`: full file = 1 video, 2 audio, 2 subtitle streams; duration equals `timeline.json total`.
- Video: pix_fmt yuv420p, range tv, bt709 on the final file AND on every segment (mixed tags break VLC).
- Loudness about -16..-18 LUFS, true/sample peak below 0 dBFS (`ffmpeg -af ebur128=peak=true`).
- First 20 ms of each narration clip is silent (no click); no spoken prompt (STT check); sample frames viewed.
- Both subtitle files open correctly (Russian/Cyrillic not mojibake: BOM for Windows players).
- Credits for music licence present in end card and in the YouTube description.

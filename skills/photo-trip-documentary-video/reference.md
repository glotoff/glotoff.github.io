# Reference: pitfalls, fixes and publishing

Everything below was learned the hard way while building the Uzbekistan 2026 film. Each item = symptom -> cause -> fix.

## Narration (Gemini TTS)
| Symptom | Cause | Fix |
|---|---|---|
| Narrator reads "Read this as a warm, calm narrator..." aloud | TTS models speak any instruction placed before the text | No instruction prefix at all. Charon is calm by default. Check with `12_stt_check.py` (transcribe first 12 s with `gemini-2.5-flash`). |
| Click/"pshshs" at the start and end of every clip | The API adds a loud (rms ~0.5) burst: ~5 ms at the start, ~120 ms at the end | Silence the start burst (do not trim: keeps durations), cut the end burst, 20-30 ms fades (`tts_lib.clean_pcm`, `13_fix_clicks.py`, `afade=t=in:d=0.03` per clip in the mix). |
| 429 RESOURCE_EXHAUSTED after ~100 clips | Tier-1 limit: 100 requests/day/model, failed retries count | Use the Batch API (`client.batches.create(model, src=[{contents, config}...])`, poll, read `dest.inlined_responses`). Do not loop retries on a dead quota. |
| Voice sounds rushed (~190 wpm) | Model default pace | `ffmpeg -af atempo=0.92` per clip, then recompute durations. |
| Cost | Standard $9 / 1M audio tokens (3.8 flash, 25 tokens per second of audio), batch half price | A 17-minute narration x2 languages costs well under $1. |
Mixing models between clips changes the voice; keep one model for all clips of a film.

## Video
- **VLC shows only sound / Windows Media Player works:** mixed colour tags between segments (phone HDR HLG clips yuv420p tv bt2020
  vs JPEG-derived yuvj420p full range). Tone-map HLG (`zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`),
  convert JPEG with `scale=in_range=pc:out_range=tv`, and tag every output `setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709` + `-color_range tv -colorspace bt709 ...`.
- **drawtext textfile shows garbled multi-line text on Windows:** Python wrote CRLF. Write the file with `write_bytes(text.encode())` (LF only).
- Readability on bright photos: overlay a transparent-to-black gradient PNG with alpha fade instead of a hard box.
- Remotion has no Windows ARM64 compositor: run it with an x64 Node (`NODE_X64_DIR`). Pass props with `--props=<file>`.
- `alimiter` autoscales unless `level=0`; `loudnorm` can overshoot after AAC encode: leave 2 dB headroom (limit 0.72-0.76).

## Subtitles and containers
- MP4 `mov_text` tracks are NOT shown by Windows Media Player and are unreliable in VLC; MKV with `srt` streams works in VLC.
- Sidecar `.srt` for Windows players must be UTF-8 **with BOM** and CRLF, otherwise Cyrillic shows as mojibake.
- `YouTube ignores embedded subtitle and extra audio tracks`. Plain UTF-8 SRT (no BOM) for YouTube.

## Music
- incompetech.com lists tracks with JavaScript; fetching the page returns an empty shell. Use a real browser tool, search by keyword
  (e.g. "desert", "ambient", "piano"), then download `https://incompetech.com/music/royalty-free/mp3-royaltyfree/<URL-encoded Title>.mp3`
  (some titles 404 - skip them). License: CC BY 4.0, attribution mandatory (end card + description).
- Measure each track with `ebur128` and apply per-track gain (target about -19.5 LUFS) before mixing; downloads range from -28 to -11 LUFS.
- Plan music per location/theme (title, mountains, ancient sites, desert/somber, bazaar day, night, finale), switch at segment boundaries,
  use different offsets when a track returns.

## Facts and locations
- Phone GPS can be wrong (one day had coordinates in another country): use the median cluster, sanity-check with the user.
- Reverse geocoding gives streets, not monuments; confirm names via web search and hedge anything unverified in the script.

## YouTube publishing (manual steps)
1. studio.youtube.com -> Create -> Upload -> `<NAME>_<VERSION>_EN.mp4` (single audio). Title, description with music credits, Unlisted first.
2. Content -> video -> Subtitles: Add language English -> Upload file -> With timing -> `subs_en.srt` -> Publish. Repeat for Russian.
3. Languages page: Russian row -> Audio -> Add -> `Audio_RU.m4a` (multi-language audio needs an eligible channel; fallback:
   upload the `_RU.mp4` as a separate video).
4. Check signed-out: gear -> Subtitles and Audio track; then set Public.
Automation: YouTube Data API v3 (`videos.insert`, `captions.insert`, `thumbnails.set`) can upload video + subtitles; extra audio tracks
are, to my knowledge, Studio-only. Uploads from unaudited API projects may be forced private.

## Security
- API keys only in environment variables, inline per command; never in files, logs or commits. Rotate keys that were pasted into chat.
- Delete only specific files you created; never `rm` globs of the project folder.

#!/bin/sh
# One command: timeline → picture → master with the song → poster and subtitles.
set -e
LIB=${LIB:-/home/user/lemomo-ai/lemo-opuscar}
HERE=$(cd "$(dirname "$0")" && pwd)
export LIB
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the library folder"; exit 1; }
# the pre-installed headless Chromium (this machine cannot download Playwright's own)
[ -n "$PLAYWRIGHT_CHROME" ] || [ ! -x /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell ] || export PLAYWRIGHT_CHROME=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
"$LIB/.venv/bin/python" "$HERE/make_timeline.py"
cd "$LIB"
node core/render/video.mjs "$HERE" --fps 24 --workers 4 --out "$HERE/out/video.mp4"
mkdir -p "$HERE/out"
ffmpeg -v error -y -i "$HERE/song.mp3" -ar 48000 -ac 2 "$HERE/out/mix.wav"        # the song is the whole soundtrack
sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/spell-and-count.mp4" 24 0
"$LIB/.venv/bin/python" core/render/srt.py "$HERE/cues.json" "$HERE/spell-and-count.srt"
node core/render/still.mjs "$HERE" 197.5 --out "$HERE/out" --prefix poster_
ffmpeg -v error -y -i "$HERE/out/poster_197.5.jpg" -q:v 2 "$HERE/poster.jpg"

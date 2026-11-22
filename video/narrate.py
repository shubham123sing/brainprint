"""Makes one WAV per scene from script.json with the local Piper voice, and prints each duration.

    .venv/Scripts/python narrate.py [script.json]
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).parent
VOICE = HERE / "voices" / "en_US-ryan-high.onnx"
SCRIPT = HERE / (sys.argv[1] if len(sys.argv) > 1 else "script.json")
OUT = HERE / "out" / "voice" / ("" if SCRIPT.stem == "script" else SCRIPT.stem)
OUT.mkdir(parents=True, exist_ok=True)

script = json.loads(SCRIPT.read_text(encoding="utf-8"))
durations = {}
for s in script["scenes"]:
    wav = OUT / f"{s['id']}.wav"
    subprocess.run([sys.executable, "-m", "piper", "-m", str(VOICE), "-f", str(wav), "--length-scale", "1.04",
                    "--sentence-silence", "0.25"], input=s["say"].encode("utf-8"), check=True, capture_output=True)
    with wave.open(str(wav)) as w:
        durations[s["id"]] = round(w.getnframes() / w.getframerate(), 2)
    print(f"{s['id']:10s} {durations[s['id']]:6.2f}s")
(OUT / "durations.json").write_text(json.dumps(durations, indent=1))
print(f"total {sum(durations.values()):.1f}s")

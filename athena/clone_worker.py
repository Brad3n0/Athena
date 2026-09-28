"""Custom voice helper. Runs in its own Python environment (.venv-voiceclone) so its big libraries can't
clash with Athena's. Athena starts it, sends one JSON line per sentence, and it writes a WAV file back.

Protocol (stdin → stdout, one line each):  {"text", "sample", "out"}  →  "@@ATHENA@@ {"ok": true}" or {"error": ...}
Anything else it prints (library logs, progress bars) is ignored by Athena.
"""
import json
import os
import sys
import wave

MARK = "@@ATHENA@@ "


def reply(data):
    sys.stdout.write(MARK + json.dumps(data) + "\n")
    sys.stdout.flush()


def main():
    try:
        import torch
        from chatterbox.tts import ChatterboxTTS

        torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = ChatterboxTTS.from_pretrained(device=device)
    except Exception as exc:  # tell Athena why, then stop
        reply({"error": f"Couldn't start the custom voice: {exc}"})
        return
    reply({"ready": True, "device": device})
    for line in sys.stdin:
        try:
            req = json.loads(line)
            wav = model.generate(req["text"], audio_prompt_path=req["sample"],
                                 exaggeration=float(req.get("exaggeration", 0.5)), cfg_weight=float(req.get("cfg", 0.5)))
            samples = wav.squeeze().detach().cpu().numpy().clip(-1.0, 1.0)
            pcm = (samples * 32767).astype("<i2").tobytes()
            with wave.open(req["out"], "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(int(model.sr))
                w.writeframes(pcm)
            reply({"ok": True})
        except Exception as exc:
            reply({"error": str(exc)})


if __name__ == "__main__":
    main()

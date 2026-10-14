import os
import subprocess
import sys
import time
from pathlib import Path

SRC = str(Path(__file__).resolve().parents[1] / "src")


def start(tmp_path, **env):
    """The service as the app starts it: its own process, with a pipe for stdin."""
    return subprocess.Popen(
        [sys.executable, "-m", "qwen_tts_service"],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={
            **os.environ,
            "PYTHONPATH": SRC,
            "QWEN_TTS_PORT": "0",
            "QWEN_TTS_MODELS_DIR": str(tmp_path),
            **env,
        },
    )


def test_exits_when_the_app_that_started_it_goes_away(tmp_path):
    proc = start(tmp_path, QWEN_TTS_EXIT_WITH_STDIN="1")
    try:
        time.sleep(2)  # let it start serving
        assert proc.poll() is None
        proc.stdin.close()  # what the OS does when the app dies
        assert proc.wait(timeout=15) == 0
    finally:
        proc.kill()


def test_keeps_running_without_the_option_even_if_stdin_closes(tmp_path):
    # Run by hand from a terminal (or `pnpm tts`), it must not exit just because stdin is empty.
    proc = start(tmp_path)
    try:
        time.sleep(2)
        proc.stdin.close()
        time.sleep(2)
        assert proc.poll() is None
    finally:
        proc.kill()

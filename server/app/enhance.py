import enum
import os
import shutil
import tempfile
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import CACHE_DIR
from .tasks import Task, tasks


class EnhanceState(str, enum.Enum):
    QUEUED = "queued"
    LOADING_MODEL = "loading_model"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


@dataclass
class EnhanceTask(Task):
    state: EnhanceState = EnhanceState.QUEUED
    progress: float = 0
    error: Optional[str] = None

    def __post_init__(self):
        self.enhanced_audio: Optional[bytes] = None


_clearvoice_cache = {}


def _get_clearvoice(use_vad: bool):
    key = ("se_vad" if use_vad else "se")
    if key not in _clearvoice_cache:
        from clearvoice import ClearVoice

        _clearvoice_cache[key] = ClearVoice(
            task="speech_enhancement",
            model_names=["MossFormer2_SE_48K"],
        )
    return _clearvoice_cache[key]


def process_enhancement(file_bytes: bytes, use_vad: bool, task_uuid: str):
    task: EnhanceTask = tasks.get(task_uuid)
    try:
        task.state = EnhanceState.LOADING_MODEL
        cv = _get_clearvoice(use_vad)

        task.state = EnhanceState.PROCESSING
        task.progress = 0.1

        workdir = tempfile.mkdtemp(dir=CACHE_DIR)
        input_path = os.path.join(workdir, "input.wav")
        output_dir = os.path.join(workdir, "output")
        os.makedirs(output_dir)

        with open(input_path, "wb") as f:
            f.write(file_bytes)

        task.progress = 0.2
        cv(input_path=input_path, online_write=True, output_path=output_dir)
        task.progress = 0.9

        output_files = list(Path(output_dir).rglob("*.wav"))
        if not output_files:
            raise RuntimeError("Enhancement produced no output")

        with open(output_files[0], "rb") as f:
            task.enhanced_audio = f.read()

        shutil.rmtree(workdir, ignore_errors=True)
        task.progress = 1.0
        task.state = EnhanceState.DONE

    except Exception as e:
        traceback.print_exc()
        task.error = str(e)
        task.state = EnhanceState.FAILED

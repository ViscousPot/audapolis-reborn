import enum
import shutil
import tempfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Union
from urllib.parse import urlparse
from zipfile import ZipFile

import requests
import yaml
from vosk import Model

from .config import CACHE_DIR, DATA_DIR
from .tasks import Task, tasks


_LANG_NAME_TO_ISO = {
    "english": "en",
    "indian english": "en",
    "german": "de",
    "french": "fr",
    "spanish": "es",
    "italian": "it",
    "portuguese": "pt",
    "russian": "ru",
    "dutch": "nl",
    "polish": "pl",
    "swedish": "sv",
    "japanese": "ja",
    "chinese": "zh",
    "chinese other": "zh",
    "korean": "ko",
    "ukrainian": "uk",
    "turkish": "tr",
    "arabic": "ar",
}


def _lang_name_to_iso(lang_name: str):
    if not lang_name:
        return None
    key = lang_name.strip().lower()
    if key == "multilingual":
        return None
    return _LANG_NAME_TO_ISO.get(key)


class LanguageDoesNotExist(Exception):
    pass


class ModelDoesNotExist(Exception):
    pass


class ModelNotDownloaded(Exception):
    pass


class ModelTypeNotSupported(Exception):
    pass


@dataclass
class ModelDescription:
    name: str
    url: str
    description: str
    size: str
    type: str
    lang: str
    compressed: bool = field(default=False)
    backend: str = field(default="vosk")
    model_id: str = field(default=None)

    def __post_init__(self):
        self.model_id = f"{self.type}-{self.lang}-{self.name}"

    def whisper_name(self) -> str:
        return self.url.split("://", 1)[1]

    def path(self) -> Path:
        if self.backend == "whisper":
            return DATA_DIR / f"whisper-{self.whisper_name()}.marker"
        url = urlparse(self.url)
        return DATA_DIR / (Path(url.path).name + ".model")

    def is_downloaded(self) -> bool:
        return self.path().exists()


@dataclass
class Language:
    lang: str
    transcription_models: List[ModelDescription] = field(default_factory=list)

    def all_models(self):
        return self.transcription_models


class ModelDefaultDict(defaultdict):
    def __missing__(self, key):
        self[key] = Language(lang=key)
        return self[key]


class Models:
    def __init__(self):
        languages = ModelDefaultDict()
        models = {}

        model_files = [
            Path(__file__).parent / "whisper_models.yml",
            Path(__file__).parent / "models.yml",
        ]
        for model_file in model_files:
            if not model_file.exists():
                continue
            with open(model_file, "r") as f:
                models_raw = yaml.safe_load(f) or {}
            for lang, lang_models in list(models_raw.items()):
                for model in lang_models:
                    model_description = ModelDescription(lang=lang, **model)
                    models[model_description.model_id] = model_description
                    if model["type"] == "transcription":
                        languages[lang].transcription_models.append(model_description)
        self.available = dict(languages)
        self.model_descriptions = models

        self.loaded = {}

    @property
    def downloaded(self) -> Dict[str, ModelDescription]:
        filtered = {}
        for lang_name, lang in list(self.available.items()):
            for model in lang.all_models():
                if model.is_downloaded():
                    filtered[model.model_id] = model
        return filtered

    def get_model_description(self, model_id) -> ModelDescription:
        if model_id not in self.model_descriptions:
            raise ModelDoesNotExist

        return self.model_descriptions[model_id]

    def _load_model(self, model):
        if model.type != "transcription":
            raise ModelTypeNotSupported()
        if model.backend == "whisper":
            from .whisper_backend import WhisperWrapper

            lang = _lang_name_to_iso(model.lang)
            return WhisperWrapper(model.whisper_name(), language=lang)
        return Model(str(model.path()))

    def get(self, model_id: str) -> Union[Model]:
        model = self.get_model_description(model_id)
        if not model.is_downloaded():
            raise ModelNotDownloaded()

        if model_id not in self.loaded:
            self.loaded[model_id] = self._load_model(model)
        return self.loaded[model_id]

    def download(self, model_id: str, task_uuid: str):
        task: DownloadModelTask = tasks.get(task_uuid)
        model = self.get_model_description(model_id)

        if model.backend == "whisper":
            task.state = DownloadModelState.DOWNLOADING
            task.total = 1
            from .whisper_backend import WhisperWrapper

            lang = _lang_name_to_iso(model.lang)
            wrapper = WhisperWrapper(model.whisper_name(), language=lang)
            wrapper.asr()
            try:
                wrapper.align(lang or "en")
            except Exception:
                pass
            task.add_progress(1)
            model.path().parent.mkdir(parents=True, exist_ok=True)
            model.path().write_text(f"whisper={model.whisper_name()}\n")
            task.state = DownloadModelState.DONE
            return

        with tempfile.TemporaryFile(dir=CACHE_DIR) as f:
            response = requests.get(model.url, stream=True)
            task.total = int(response.headers.get("content-length"))
            task.state = DownloadModelState.DOWNLOADING

            for data in response.iter_content(
                chunk_size=max(int(task.total / 1000), 1024 * 1024)
            ):
                task.add_progress(len(data))

                f.write(data)
                if task.canceled:
                    return

            task.state = DownloadModelState.EXTRACTING
            if model.compressed:
                with ZipFile(f) as archive:
                    target_dir = model.path()
                    for info in archive.infolist():
                        if info.is_dir():
                            continue
                        path = target_dir / Path("/".join(info.filename.split("/")[1:]))
                        path.parent.mkdir(exist_ok=True, parents=True)

                        source = archive.open(info.filename)
                        target = open(path, "wb")
                        with source, target:
                            shutil.copyfileobj(source, target)
            else:
                f.seek(0)
                with open(model.path(), "wb") as target:
                    shutil.copyfileobj(f, target)

        task.state = DownloadModelState.DONE

    def delete(self, model_id: str):
        model = self.get_model_description(model_id)
        if model.is_downloaded():
            path = model.path()
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        else:
            raise ModelNotDownloaded()


models = Models()


class DownloadModelState(str, enum.Enum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    DONE = "done"
    CANCELED = "canceled"


@dataclass
class DownloadModelTask(Task):
    model_id: str
    state: DownloadModelState = DownloadModelState.QUEUED
    total: float = 0
    processed: float = 0
    progress: float = 0

    def __post_init__(self):
        self.canceled = False

    def add_progress(self, added):
        self.processed += added
        self.progress = self.processed / self.total

    def cancel(self):
        self.canceled = True

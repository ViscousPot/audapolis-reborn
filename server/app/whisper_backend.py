import gc
from typing import Callable, List, Optional

import numpy as np
import torch
from pydub import AudioSegment

import whisperx
from whisperx.diarize import DiarizationPipeline, assign_word_speakers

SAMPLE_RATE = 16000
EPSILON = 0.00001


class DiarizationFailed(Exception):
    def __init__(self, message: str, paragraphs: list):
        super().__init__(message)
        self.paragraphs = paragraphs


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def _compute_type() -> str:
    return "float16" if torch.cuda.is_available() else "int8"


class WhisperWrapper:
    def __init__(self, whisper_name: str, language: Optional[str] = None):
        self.whisper_name = whisper_name
        self.language = language
        self.device = _device()
        self.compute_type = _compute_type()
        self._asr = None
        self._align_models: dict = {}
        self._diar_pipeline = None

    def asr(self):
        if self._asr is None:
            print(
                f"[whisper] loading ASR model={self.whisper_name} "
                f"device={self.device} compute_type={self.compute_type}",
                flush=True,
            )
            self._asr = whisperx.load_model(
                self.whisper_name,
                device=self.device,
                compute_type=self.compute_type,
                language=self.language,
            )
        return self._asr

    def align(self, language_code: str):
        if language_code not in self._align_models:
            print(
                f"[whisper] loading align model for language={language_code}",
                flush=True,
            )
            model, metadata = whisperx.load_align_model(
                language_code=language_code, device=self.device
            )
            self._align_models[language_code] = (model, metadata)
        return self._align_models[language_code]

    def diarizer(self):
        if self._diar_pipeline is None:
            from .config import get_hf_token

            hf_token = get_hf_token()
            if not hf_token:
                raise RuntimeError("HuggingFace token not set")
            print("[whisper] loading diarization pipeline", flush=True)
            self._diar_pipeline = DiarizationPipeline(
                token=hf_token, device=self.device
            )
        return self._diar_pipeline


def _pydub_to_float32(audio: AudioSegment) -> np.ndarray:
    audio = audio.set_frame_rate(SAMPLE_RATE).set_channels(1)
    samples = np.array(audio.get_array_of_samples()).astype(np.float32)
    if audio.sample_width == 2:
        samples /= 1 << 15
    elif audio.sample_width == 4:
        samples /= 1 << 31
    return samples


def transcribe_with_whisper(
    wrapper: WhisperWrapper,
    audio: AudioSegment,
    fileName: str,
    diarize: bool,
    diarize_max_speakers: Optional[int],
    set_progress: Callable[[float], None],
) -> List[dict]:
    duration = audio.duration_seconds
    samples = _pydub_to_float32(audio)

    asr = wrapper.asr()
    asr_result = asr.transcribe(samples, batch_size=16)
    set_progress(duration * 0.5)

    language = asr_result.get("language") or wrapper.language or "en"
    align_model, align_metadata = wrapper.align(language)
    aligned = whisperx.align(
        asr_result["segments"],
        align_model,
        align_metadata,
        samples,
        wrapper.device,
        return_char_alignments=False,
    )
    set_progress(duration * 0.3)

    if diarize:
        try:
            diar = wrapper.diarizer()
            diar_kwargs = {}
            if diarize_max_speakers is not None:
                diar_kwargs["max_speakers"] = diarize_max_speakers
            diar_segments = diar(samples, **diar_kwargs)
            aligned = assign_word_speakers(diar_segments, aligned)
        except Exception as e:
            set_progress(duration * 0.2)
            if wrapper.device == "cuda":
                gc.collect()
                torch.cuda.empty_cache()
            fallback = _to_audapolis_paragraphs(aligned, fileName, duration, False)
            raise DiarizationFailed(str(e), fallback) from e

    set_progress(duration * 0.2)

    if wrapper.device == "cuda":
        gc.collect()
        torch.cuda.empty_cache()

    return _to_audapolis_paragraphs(aligned, fileName, duration, diarize)


def _to_audapolis_paragraphs(
    aligned: dict, fileName: str, total_duration: float, diarize: bool
) -> List[dict]:
    words: List[dict] = []
    for seg in aligned.get("segments", []):
        seg_speaker = seg.get("speaker") if diarize else None
        for w in seg.get("words", []):
            if "start" not in w or "end" not in w:
                continue
            words.append(
                {
                    "word": str(w.get("word", "")).strip(),
                    "start": float(w["start"]),
                    "end": float(w["end"]),
                    "conf": float(w.get("score", 0.0)),
                    "speaker": w.get("speaker") or seg_speaker,
                }
            )

    if not words:
        return [
            {
                "speaker": fileName,
                "content": [
                    {
                        "sourceStart": 0.0,
                        "length": total_duration,
                        "type": "silence",
                    }
                ],
            }
        ]

    groups: List[tuple] = []
    cur_speaker = words[0]["speaker"]
    bucket: List[dict] = []
    for w in words:
        if w["speaker"] != cur_speaker:
            groups.append((cur_speaker, bucket))
            bucket = []
            cur_speaker = w["speaker"]
        bucket.append(w)
    groups.append((cur_speaker, bucket))

    paragraphs: List[dict] = []
    for i, (speaker, group_words) in enumerate(groups):
        if diarize and speaker:
            label = f"{speaker} ({fileName})"
        else:
            label = fileName

        seg_start = 0.0 if i == 0 else group_words[0]["start"]
        seg_end = (
            total_duration if i == len(groups) - 1 else groups[i + 1][1][0]["start"]
        )

        content: List[dict] = []
        current_time = seg_start
        for w in group_words:
            word_start = w["start"]
            if word_start > current_time + 10 * EPSILON:
                content.append(
                    {
                        "sourceStart": current_time,
                        "length": word_start - current_time,
                        "type": "silence",
                    }
                )
            else:
                word_start = current_time
            content.append(
                {
                    "sourceStart": word_start,
                    "length": max(w["end"] - word_start, EPSILON),
                    "type": "word",
                    "word": w["word"],
                    "conf": w["conf"],
                }
            )
            current_time = w["end"]

        if current_time < seg_end:
            if (seg_end - current_time) < 10 * EPSILON and content:
                content[-1]["length"] += seg_end - current_time
            else:
                content.append(
                    {
                        "sourceStart": current_time,
                        "length": seg_end - current_time,
                        "type": "silence",
                    }
                )

        paragraphs.append({"speaker": label, "content": content})

    return paragraphs

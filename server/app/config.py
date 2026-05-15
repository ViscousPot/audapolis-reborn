import os
from pathlib import Path
from typing import Optional

import appdirs

DATA_DIR = Path(
    os.environ.get("AUDAPOLIS_DATA_DIR", appdirs.user_data_dir("audapolis"))
)
DATA_DIR.mkdir(exist_ok=True, parents=True)

CACHE_DIR = Path(
    os.environ.get("AUDAPOLIS_CACHE_DIR", appdirs.user_cache_dir("audapolis"))
)
CACHE_DIR.mkdir(exist_ok=True, parents=True)

HF_TOKEN_PATH = DATA_DIR / "hf_token"


def get_hf_token() -> Optional[str]:
    if HF_TOKEN_PATH.exists():
        token = HF_TOKEN_PATH.read_text().strip()
        if token:
            return token
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or None

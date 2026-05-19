#!/bin/bash
set -e
cd "$(dirname "$0")"

CHECKPOINT_DIR="checkpoints/MossFormer2_SE_48K"

if [ -f "$CHECKPOINT_DIR/last_best_checkpoint.pt" ]; then
    echo "MossFormer2_SE_48K already downloaded"
    exit 0
fi

echo "Downloading MossFormer2_SE_48K checkpoint..."
.venv/bin/python -c "
from huggingface_hub import snapshot_download
snapshot_download(repo_id='alibabasglab/MossFormer2_SE_48K', local_dir='$CHECKPOINT_DIR')
"
echo "Done"

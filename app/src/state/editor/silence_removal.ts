import { createActionWithReducer } from '../util';
import { EditorState } from './types';
import { V3DocumentItem } from '../../core/document';

export const VISIBLE_SILENCE_THRESHOLD = 0.4;

export function filterLongSilences(
  content: V3DocumentItem[],
  threshold: number = VISIBLE_SILENCE_THRESHOLD
): V3DocumentItem[] {
  return content.filter((item) => {
    if (item.type !== 'non_text' && item.type !== 'artificial_silence') return true;
    return item.length <= threshold;
  });
}

export const toggleSilenceRemoval = createActionWithReducer<EditorState>(
  'editor/toggleSilenceRemoval',
  (state) => {
    state.silenceRemovalActive = !state.silenceRemovalActive;
    state.selection = null;
    state.cursor.current = 'user';
    state.cursor.userIndex = Math.min(state.cursor.userIndex, state.document.content.length);
  }
);

export const setSilenceThreshold = createActionWithReducer<EditorState, number>(
  'editor/setSilenceThreshold',
  (state, threshold) => {
    state.silenceThreshold = threshold;
  }
);

import { createActionWithReducer } from '../util';
import { EditorState } from './types';

export const VISIBLE_SILENCE_THRESHOLD = 0.4;

export const removeAllSilences = createActionWithReducer<EditorState>(
  'editor/removeAllSilences',
  (state) => {
    state.document.content = state.document.content.filter((item) => {
      if (item.type !== 'non_text' && item.type !== 'artificial_silence') return true;
      return item.length <= VISIBLE_SILENCE_THRESHOLD;
    });
    state.selection = null;
    state.cursor.current = 'user';
    state.cursor.userIndex = Math.min(state.cursor.userIndex, state.document.content.length);
  }
);

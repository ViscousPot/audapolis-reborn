import { createActionWithReducer } from '../util';
import { EditorState } from './types';

export const setVolume = createActionWithReducer<EditorState, number>(
  'editor/setVolume',
  (state, volume) => {
    state.volume = Math.max(0, Math.min(1, volume));
  }
);

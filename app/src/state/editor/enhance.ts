import { createActionWithReducer, createAsyncActionWithReducer } from '../util';
import { EditorState } from './types';
import { getServer } from '../server';
import { sleep } from '../../util';
import {
  startEnhancement as startEnhancementApi,
  getTask,
  getEnhancedAudio,
  deleteTask,
  EnhanceState as ApiEnhanceState,
} from '../../server_api/api';

export const setEnhanceProgress = createActionWithReducer<
  EditorState,
  { running: boolean; progress: number; sourceHash?: string }
>('editor/setEnhanceProgress', (state, payload) => {
  state.enhanceState = payload;
});

export const enhanceSource = createAsyncActionWithReducer<
  EditorState,
  { sourceHash: string; useVad: boolean },
  { sourceHash: string; enhancedFileContents: ArrayBuffer; enhancedObjectUrl: string }
>(
  'editor/enhanceSource',
  async ({ sourceHash, useVad }, { dispatch, getState }) => {
    const state = getState();
    const server = getServer(state);
    const source = state.editor.present?.document.sources[sourceHash];
    if (!source) throw new Error('Source not found');

    dispatch(setEnhanceProgress({ running: true, progress: 0, sourceHash }));

    const file = new File([source.fileContents], 'input.wav');
    const task = await startEnhancementApi(server, file, useVad);

    while (true) {
      const result = await getTask(server, task);
      dispatch(
        setEnhanceProgress({ running: true, progress: result.progress, sourceHash })
      );

      if (result.state === ApiEnhanceState.DONE) {
        const enhancedFileContents = await getEnhancedAudio(server, task.uuid);
        const enhancedObjectUrl = URL.createObjectURL(new Blob([enhancedFileContents]));
        await deleteTask(server, task.uuid);
        dispatch(setEnhanceProgress({ running: false, progress: 1 }));
        return { sourceHash, enhancedFileContents, enhancedObjectUrl };
      } else if (result.state === ApiEnhanceState.FAILED) {
        const error = result.error || 'Enhancement failed';
        await deleteTask(server, task.uuid);
        throw new Error(error);
      }
      await sleep(0.2);
    }
  },
  {
    fulfilled: (state, { sourceHash, enhancedFileContents, enhancedObjectUrl }) => {
      const source = state.document.sources[sourceHash];
      if (source) {
        source.enhancedFileContents = enhancedFileContents;
        source.enhancedObjectUrl = enhancedObjectUrl;
        source.enhancedActive = true;
      }
    },
    rejected: (state) => {
      state.enhanceState = { running: false, progress: 0 };
    },
  }
);

export const toggleEnhancement = createActionWithReducer<EditorState, string>(
  'editor/toggleEnhancement',
  (state, sourceHash) => {
    const source = state.document.sources[sourceHash];
    if (source?.enhancedFileContents) {
      source.enhancedActive = !source.enhancedActive;
      state.playing = false;
    }
  }
);

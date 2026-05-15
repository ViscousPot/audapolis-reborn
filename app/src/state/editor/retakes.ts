import { createActionWithReducer } from '../util';
import { EditorState } from './types';
import { V3DocumentItem } from '../../core/document';
import { memoize } from './selectors';

export type RetakeHighlightKind = 'discard' | 'keep';

const MIN_REPEAT_WORDS = 3;
const MAX_REPEAT_DISTANCE_WORDS = 20;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .trim();
}

function computeRetakeHighlights(content: V3DocumentItem[]): Record<string, RetakeHighlightKind> {
  type Word = { uuid: string; normalized: string };
  const words: Word[] = [];
  for (const item of content) {
    if (item.type !== 'text') continue;
    const norm = normalize(item.text);
    if (!norm) continue;
    words.push({ uuid: item.uuid, normalized: norm });
  }
  const n = words.length;
  if (n < MIN_REPEAT_WORDS * 2) return {};

  const positions = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = words[i].normalized;
    let arr = positions.get(key);
    if (!arr) {
      arr = [];
      positions.set(key, arr);
    }
    arr.push(i);
  }

  const result: Record<string, RetakeHighlightKind> = {};

  for (let i = 0; i < n; i++) {
    if (words[i].uuid in result) continue;
    const candidates = positions.get(words[i].normalized);
    if (!candidates) continue;

    let maxK = 0;
    const matchingJs: number[] = [];
    for (let ci = 0; ci < candidates.length; ci++) {
      const j: number = candidates[ci];
      if (j <= i || words[j].uuid in result) continue;
      if (j - i > MAX_REPEAT_DISTANCE_WORDS) break;
      let k = 1;
      while (
        i + k < j &&
        j + k < n &&
        !(words[i + k].uuid in result) &&
        !(words[j + k].uuid in result) &&
        words[i + k].normalized === words[j + k].normalized
      ) {
        k++;
      }
      if (k >= MIN_REPEAT_WORDS) {
        if (k > maxK) {
          maxK = k;
          matchingJs.length = 0;
        }
        if (k === maxK) matchingJs.push(j);
      }
    }
    if (matchingJs.length === 0) continue;

    for (let k = 0; k < maxK; k++) {
      result[words[i + k].uuid] = 'discard';
    }
    matchingJs.sort((a, b) => a - b);
    const lastJ = matchingJs[matchingJs.length - 1];
    for (let ci = 0; ci < matchingJs.length - 1; ci++) {
      const j = matchingJs[ci];
      for (let k = 0; k < maxK; k++) {
        result[words[j + k].uuid] = 'discard';
      }
    }
    for (let k = 0; k < maxK; k++) {
      result[words[lastJ + k].uuid] = 'keep';
    }
  }

  return result;
}

export const memoizedRetakeHighlights = memoize(computeRetakeHighlights);

export const toggleDisplayRetakes = createActionWithReducer<EditorState>(
  'retakes/toggleDisplay',
  (state) => {
    state.displayRetakes = !state.displayRetakes;
  }
);

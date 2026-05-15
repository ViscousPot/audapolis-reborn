import { createActionWithReducer } from '../util';
import { EditorState } from './types';
import { V3DocumentItem } from '../../core/document';
import { v4 as uuidv4 } from 'uuid';

const EPS = 0.0001;

export const openTimingEditor = createActionWithReducer<EditorState, string>(
  'timing_editor/open',
  (state, uuid) => {
    state.timingEditor = { focusUuid: uuid };
  }
);

export const closeTimingEditor = createActionWithReducer<EditorState>(
  'timing_editor/close',
  (state) => {
    state.timingEditor = null;
  }
);

export const setWordText = createActionWithReducer<EditorState, { uuid: string; text: string }>(
  'timing_editor/setWordText',
  (state, { uuid, text }) => {
    const item = state.document.content.find((x) => x.uuid === uuid);
    if (!item || item.type !== 'text') return;
    item.text = text;
  }
);

export const setWordTiming = createActionWithReducer<
  EditorState,
  { uuid: string; sourceStart: number; length: number }
>('timing_editor/setWordTiming', (state, { uuid, sourceStart, length }) => {
  const content = state.document.content;
  let i = content.findIndex((x) => x.uuid === uuid);
  if (i < 0) return;
  const word = content[i];
  if (word.type !== 'text' && word.type !== 'non_text') return;
  if (length <= 0) return;

  const source = word.source;

  for (let j = content.length - 2; j >= 0; j--) {
    const a = content[j];
    const b = content[j + 1];
    if (
      a.type === 'non_text' &&
      b.type === 'non_text' &&
      a.source === source &&
      b.source === source
    ) {
      const aEnd = a.sourceStart + a.length;
      if (Math.abs(aEnd - b.sourceStart) < 0.002) {
        a.length += b.length;
        content.splice(j + 1, 1);
      }
    }
  }
  i = content.findIndex((x) => x.uuid === uuid);
  if (i < 0) return;

  const oldStart = word.sourceStart;
  const oldEnd = oldStart + word.length;
  const newStart = sourceStart;
  const newEnd = sourceStart + length;

  const prev = findSourceNeighbour(content, i, -1, source);
  if (prev) {
    const prevEnd = prev.item.sourceStart + prev.item.length;
    if (Math.abs(prevEnd - oldStart) < EPS || prevEnd > oldStart) {
      prev.item.length = Math.max(0, newStart - prev.item.sourceStart);
    }
  }

  const next = findSourceNeighbour(content, i, +1, source);
  if (next) {
    if (Math.abs(next.item.sourceStart - oldEnd) < EPS || next.item.sourceStart < oldEnd) {
      const diff = newEnd - next.item.sourceStart;
      next.item.sourceStart = newEnd;
      next.item.length = Math.max(0, next.item.length - diff);
    }
  }

  word.sourceStart = newStart;
  word.length = length;

  for (let j = content.length - 1; j >= 0; j--) {
    const it = content[j];
    if (it.type === 'non_text' && it.length <= EPS) {
      content.splice(j, 1);
    }
  }
});

export const insertWordAfter = createActionWithReducer<
  EditorState,
  { afterUuid: string; text: string; newUuid: string }
>('timing_editor/insertWordAfter', (state, { afterUuid, text, newUuid }) => {
  const content = state.document.content;
  const i = content.findIndex((x) => x.uuid === afterUuid);
  if (i < 0) return;
  const anchor = content[i];
  if (anchor.type !== 'text' && anchor.type !== 'non_text') return;

  const source = anchor.source;
  const anchorEnd = anchor.sourceStart + anchor.length;

  const sibling = content[i + 1];
  const sameSourceSilence =
    sibling && sibling.type === 'non_text' && sibling.source === source && sibling.length > 2 * EPS;

  let newStart: number;
  let newLength: number;

  if (sameSourceSilence) {
    const takeable = sibling.length;
    newLength = Math.min(0.2, Math.max(0.05, takeable * 0.5));
    newStart = sibling.sourceStart;
    sibling.sourceStart += newLength;
    sibling.length -= newLength;
  } else if (anchor.type === 'text' && anchor.length > 0.1) {
    newLength = Math.min(0.2, anchor.length * 0.3);
    anchor.length -= newLength;
    newStart = anchor.sourceStart + anchor.length;
  } else {
    newStart = anchorEnd;
    newLength = EPS;
  }

  const newItem: V3DocumentItem = {
    type: 'text',
    text,
    source,
    sourceStart: newStart,
    length: newLength,
    conf: 1,
    uuid: newUuid,
  };
  content.splice(i + 1, 0, newItem);
});

export const insertWordIntoSilence = createActionWithReducer<
  EditorState,
  {
    silenceUuid: string;
    insertTime: number;
    insertLength: number;
    newWordUuid: string;
    text: string;
  }
>(
  'timing_editor/insertWordIntoSilence',
  (state, { silenceUuid, insertTime, insertLength, newWordUuid, text }) => {
    const content = state.document.content;
    const i = content.findIndex((x) => x.uuid === silenceUuid);
    if (i < 0) return;
    const silence = content[i];
    if (silence.type !== 'non_text') return;

    const silenceEnd = silence.sourceStart + silence.length;
    const start = Math.max(silence.sourceStart, Math.min(silenceEnd - EPS, insertTime));
    const length = Math.max(EPS, Math.min(silenceEnd - start, insertLength));
    const beforeLength = start - silence.sourceStart;
    const afterStart = start + length;
    const afterLength = silenceEnd - afterStart;

    const newWord: V3DocumentItem = {
      type: 'text',
      text,
      source: silence.source,
      sourceStart: start,
      length,
      conf: 1,
      uuid: newWordUuid,
    };

    const inserted: V3DocumentItem[] = [newWord];
    if (afterLength > EPS) {
      inserted.push({
        type: 'non_text',
        source: silence.source,
        sourceStart: afterStart,
        length: afterLength,
        uuid: uuidv4(),
      });
    }

    if (beforeLength <= EPS) {
      content.splice(i, 1, ...inserted);
    } else {
      silence.length = beforeLength;
      content.splice(i + 1, 0, ...inserted);
    }
  }
);

export const splitWord = createActionWithReducer<
  EditorState,
  { uuid: string; splitTime: number; textBefore: string; textAfter: string; newUuid: string }
>('timing_editor/splitWord', (state, { uuid, splitTime, textBefore, textAfter, newUuid }) => {
  const content = state.document.content;
  const i = content.findIndex((x) => x.uuid === uuid);
  if (i < 0) return;
  const word = content[i];
  if (word.type !== 'text') return;

  const origEnd = word.sourceStart + word.length;
  if (splitTime <= word.sourceStart + EPS || splitTime >= origEnd - EPS) return;

  word.text = textBefore;
  word.length = splitTime - word.sourceStart;

  const newWord: V3DocumentItem = {
    type: 'text',
    text: textAfter,
    source: word.source,
    sourceStart: splitTime,
    length: origEnd - splitTime,
    conf: 1,
    uuid: newUuid,
  };
  content.splice(i + 1, 0, newWord);
});

export const removeWord = createActionWithReducer<EditorState, { uuid: string }>(
  'timing_editor/removeWord',
  (state, { uuid }) => {
    const content = state.document.content;
    const i = content.findIndex((x) => x.uuid === uuid);
    if (i < 0) return;
    const word = content[i];
    if (word.type !== 'text' && word.type !== 'non_text') return;

    content[i] = {
      type: 'non_text',
      source: word.source,
      sourceStart: word.sourceStart,
      length: word.length,
      uuid: word.uuid,
    };

    if (i + 1 < content.length) {
      const next = content[i + 1];
      if (next.type === 'non_text' && next.source === word.source) {
        (content[i] as any).length += next.length;
        content.splice(i + 1, 1);
      }
    }

    if (i - 1 >= 0) {
      const prev = content[i - 1];
      if (prev.type === 'non_text' && prev.source === word.source) {
        prev.length += (content[i] as any).length;
        content.splice(i, 1);
      }
    }
  }
);

export const insertWordInGap = createActionWithReducer<
  EditorState,
  {
    afterItemUuid: string;
    source: string;
    gapStart: number;
    gapEnd: number;
    insertTime: number;
    insertLength: number;
    newWordUuid: string;
    text: string;
  }
>(
  'timing_editor/insertWordInGap',
  (
    state,
    { afterItemUuid, source, gapStart, gapEnd, insertTime, insertLength, newWordUuid, text }
  ) => {
    const content = state.document.content;
    const afterIdx = content.findIndex((x) => x.uuid === afterItemUuid);
    if (afterIdx < 0) return;

    const items: V3DocumentItem[] = [];

    const preLength = insertTime - gapStart;
    if (preLength > EPS) {
      items.push({
        type: 'non_text',
        source,
        sourceStart: gapStart,
        length: preLength,
        uuid: uuidv4(),
      });
    }

    items.push({
      type: 'text',
      text,
      source,
      sourceStart: insertTime,
      length: insertLength,
      conf: 1,
      uuid: newWordUuid,
    });

    const postStart = insertTime + insertLength;
    const postLength = gapEnd - postStart;
    if (postLength > EPS) {
      items.push({
        type: 'non_text',
        source,
        sourceStart: postStart,
        length: postLength,
        uuid: uuidv4(),
      });
    }

    content.splice(afterIdx + 1, 0, ...items);
  }
);

type SourceItem = { item: { source: string; sourceStart: number; length: number }; index: number };

function findSourceNeighbour(
  content: V3DocumentItem[],
  fromIndex: number,
  direction: -1 | 1,
  source: string
): SourceItem | null {
  for (let j = fromIndex + direction; j >= 0 && j < content.length; j += direction) {
    const it = content[j];
    if (it.type === 'paragraph_start' || it.type === 'paragraph_end') return null;
    if ((it.type === 'text' || it.type === 'non_text') && it.source === source) {
      return { item: it, index: j };
    }
  }
  return null;
}

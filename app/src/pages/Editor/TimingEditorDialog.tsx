import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';
import { Dialog, PauseIcon, PlayIcon } from 'evergreen-ui';
import { RootState } from '../../state';
import {
  closeTimingEditor,
  insertWordInGap,
  insertWordIntoSilence,
  removeWord,
  setWordText,
  setWordTiming,
} from '../../state/editor/timing_editor';
import { V3DocumentItem } from '../../core/document';
import { v4 as uuidv4 } from 'uuid';
import { useTheme } from '../../components/theme';

const PX_PER_SEC = 400;
const WAVEFORM_HEIGHT = 80;
const WORD_ROW_HEIGHT = 70;
const HANDLE_PX = 8;
const STRIP_PADDING_PX = 24;
const MIN_WORD_LENGTH_S = 0.02;
const CANVAS_TILE_PX = 4096;

type Peaks = { positive: Float32Array; negative: Float32Array; samplesPerPeak: number };

const decodeCache = new Map<string, Promise<{ buffer: AudioBuffer; peaks: Peaks }>>();

async function buildPeaksChunked(
  buffer: AudioBuffer,
  peaksPerSecond: number,
  onProgress: (fraction: number) => void
): Promise<Peaks> {
  const samplesPerPeak = Math.max(1, Math.floor(buffer.sampleRate / peaksPerSecond));
  const totalPeaks = Math.floor(buffer.length / samplesPerPeak);
  const positive = new Float32Array(totalPeaks);
  const negative = new Float32Array(totalPeaks);
  const channelCount = buffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++) channels.push(buffer.getChannelData(c));

  const CHUNK_PEAKS = 8000;
  for (let chunkStart = 0; chunkStart < totalPeaks; chunkStart += CHUNK_PEAKS) {
    const chunkEnd = Math.min(chunkStart + CHUNK_PEAKS, totalPeaks);
    for (let i = chunkStart; i < chunkEnd; i++) {
      const offset = i * samplesPerPeak;
      let mn = 0;
      let mx = 0;
      for (let j = 0; j < samplesPerPeak; j++) {
        for (let c = 0; c < channelCount; c++) {
          const s = channels[c][offset + j];
          if (s > mx) mx = s;
          else if (s < mn) mn = s;
        }
      }
      positive[i] = mx;
      negative[i] = mn;
    }
    onProgress(chunkEnd / totalPeaks);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { positive, negative, samplesPerPeak };
}

function decodeSource(
  objectUrl: string,
  onPeaksProgress: (fraction: number) => void
): Promise<{ buffer: AudioBuffer; peaks: Peaks }> {
  const cached = decodeCache.get(objectUrl);
  if (cached) {
    cached.then(() => onPeaksProgress(1));
    return cached;
  }
  const p = (async () => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const ab = await fetch(objectUrl).then((r) => r.arrayBuffer());
    const buffer = await ctx.decodeAudioData(ab);
    const peaks = await buildPeaksChunked(buffer, 200, onPeaksProgress);
    return { buffer, peaks };
  })();
  decodeCache.set(objectUrl, p);
  return p;
}

type DecodeState =
  | { phase: 'decoding' }
  | { phase: 'building'; progress: number }
  | { phase: 'done'; buffer: AudioBuffer; peaks: Peaks }
  | { phase: 'error'; error: string };

function useDecodedAudio(objectUrl: string | undefined): DecodeState {
  const [state, setState] = useState<DecodeState>({ phase: 'decoding' });
  useEffect(() => {
    if (!objectUrl) {
      setState({ phase: 'decoding' });
      return;
    }
    let cancelled = false;
    setState({ phase: 'decoding' });
    const id = window.setTimeout(() => {
      if (cancelled) return;
      decodeSource(objectUrl, (fraction) => {
        if (!cancelled) setState({ phase: 'building', progress: fraction });
      })
        .then((res) => {
          if (!cancelled) setState({ phase: 'done', buffer: res.buffer, peaks: res.peaks });
        })
        .catch((e) => {
          if (!cancelled) setState({ phase: 'error', error: String(e) });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [objectUrl]);
  return state;
}

interface ParagraphSlice {
  startIndex: number;
  items: (V3DocumentItem & { type: 'text' | 'non_text' })[];
  sourceId: string;
  paragraphStart: number;
  paragraphEnd: number;
}

function findParagraphSlice(content: V3DocumentItem[], focusUuid: string): ParagraphSlice | null {
  const focusIdx = content.findIndex((x) => x.uuid === focusUuid);
  if (focusIdx < 0) return null;
  let start = focusIdx;
  while (start > 0 && content[start].type !== 'paragraph_start') start--;
  let end = focusIdx;
  while (end < content.length && content[end].type !== 'paragraph_end') end++;
  const items: (V3DocumentItem & { type: 'text' | 'non_text' })[] = [];
  let sourceId: string | null = null;
  let firstIdx = -1;
  for (let i = start + 1; i < end; i++) {
    const it = content[i];
    if (it.type === 'text' || it.type === 'non_text') {
      items.push(it as V3DocumentItem & { type: 'text' | 'non_text' });
      if (sourceId === null) sourceId = it.source;
      if (firstIdx < 0) firstIdx = i;
    }
  }
  if (!sourceId || items.length === 0 || firstIdx < 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  return {
    startIndex: firstIdx,
    items,
    sourceId,
    paragraphStart: first.sourceStart,
    paragraphEnd: last.sourceStart + last.length,
  };
}

const WaveformTile = React.memo(function WaveformTile({
  peaks,
  peaksPerSec,
  tileStartTime,
  pxPerSec,
  tileWidthPx,
  height,
  fillColor,
  midLineColor,
}: {
  peaks: Peaks;
  peaksPerSec: number;
  tileStartTime: number;
  pxPerSec: number;
  tileWidthPx: number;
  height: number;
  fillColor: string;
  midLineColor: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = tileWidthPx * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${tileWidthPx}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, tileWidthPx, height);

    const midY = height / 2;
    ctx.strokeStyle = midLineColor;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(tileWidthPx, midY);
    ctx.stroke();

    ctx.fillStyle = fillColor;
    const peaksPerPx = peaksPerSec / pxPerSec;
    const firstPeakF = tileStartTime * peaksPerSec;
    for (let px = 0; px < tileWidthPx; px++) {
      const startPeak = Math.floor(firstPeakF + px * peaksPerPx);
      const endPeak = Math.max(startPeak + 1, Math.floor(firstPeakF + (px + 1) * peaksPerPx));
      let mn = 0;
      let mx = 0;
      for (let p = startPeak; p < endPeak; p++) {
        if (p < 0 || p >= peaks.positive.length) continue;
        const hi = peaks.positive[p];
        const lo = peaks.negative[p];
        if (hi > mx) mx = hi;
        if (lo < mn) mn = lo;
      }
      const top = midY - mx * (midY - 1);
      const bot = midY - mn * (midY - 1);
      ctx.fillRect(px, top, 1, Math.max(1, bot - top));
    }
  }, [peaks, peaksPerSec, tileStartTime, pxPerSec, tileWidthPx, height, fillColor, midLineColor]);

  return <canvas ref={ref} style={{ display: 'block', height, flex: '0 0 auto' }} />;
});

const StripScrollContainer = styled.div`
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
  border-radius: 6px;
  border: 1px solid transparent;
  padding: ${STRIP_PADDING_PX / 2}px 0;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const StripScrollRow = styled.div`
  display: flex;
  align-items: stretch;
  gap: 6px;
`;

const ArrowButton = styled.button`
  appearance: none;
  border: 1px solid transparent;
  width: 32px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  user-select: none;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
  &:not(:disabled):hover {
    filter: brightness(1.1);
  }
  &:not(:disabled):active {
    filter: brightness(0.92);
  }
`;

const StripInner = styled.div<{ widthPx: number }>`
  position: relative;
  width: ${(p) => p.widthPx}px;
  height: ${WAVEFORM_HEIGHT + WORD_ROW_HEIGHT + 32}px;
  cursor: crosshair;
`;

const WaveformLayer = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: row;
  pointer-events: none;
`;

const WaveformPlaceholder = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: ${WAVEFORM_HEIGHT}px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  pointer-events: none;
`;

const ProgressBarTrack = styled.div`
  width: 240px;
  height: 4px;
  margin-left: 10px;
  opacity: 0.4;
  border-radius: 2px;
  overflow: hidden;
`;

const ProgressBarFill = styled.div<{ fraction: number }>`
  height: 100%;
  width: ${(p) => Math.min(100, Math.max(0, p.fraction * 100))}%;
  transition: width 0.1s linear;
`;

const WordRow = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: ${WAVEFORM_HEIGHT + 8}px;
  height: ${WORD_ROW_HEIGHT}px;
`;

const WordBlock = styled.div`
  position: absolute;
  top: 6px;
  height: ${WORD_ROW_HEIGHT - 12}px;
  border: 1px solid transparent;
  border-radius: 3px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  user-select: none;
  cursor: grab;
  &:active {
    cursor: grabbing;
  }
  & input {
    cursor: text;
  }
`;

const SilenceBlock = styled.div`
  position: absolute;
  top: 6px;
  height: ${WORD_ROW_HEIGHT - 12}px;
  border: 1px solid rgba(200, 80, 70, 0.45);
  background: rgba(200, 80, 70, 0.12);
  border-radius: 3px;
  box-sizing: border-box;
  cursor: copy;
  &:hover {
    background: rgba(200, 80, 70, 0.22);
  }
`;

const GapBlock = styled.div`
  position: absolute;
  top: 6px;
  height: ${WORD_ROW_HEIGHT - 12}px;
  border: 1px dashed transparent;
  opacity: 0.45;
  border-radius: 3px;
  box-sizing: border-box;
  cursor: copy;
  &:hover {
    opacity: 0.65;
    background: rgba(127, 127, 127, 0.08);
  }
`;

const WordText = styled.input`
  width: calc(100% - 18px);
  padding: 2px 4px;
  border: none;
  background: transparent;
  font-size: 13px;
  text-align: center;
  outline: none;
  &:focus {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 2px;
  }
`;

const Handle = styled.div<{ side: 'left' | 'right' }>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${(p) => (p.side === 'left' ? 'left: -4px;' : 'right: -4px;')}
  width: ${HANDLE_PX}px;
  cursor: ew-resize;
  border-radius: 2px;
  z-index: 2;
`;

const Playhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  pointer-events: none;
  z-index: 5;
`;

const PlayButton = styled.button`
  appearance: none;
  border: none;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #ffffff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover {
    filter: brightness(1.08);
  }
  &:active {
    filter: brightness(0.92);
  }
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
`;

const Hint = styled.div`
  margin-top: 10px;
  font-size: 11px;
`;

export function TimingEditorDialog(): JSX.Element {
  const dispatch = useDispatch();
  const theme = useTheme();
  const timingEditor = useSelector((state: RootState) => state.editor.present?.timingEditor);
  const isOpen = !!timingEditor;
  const trapEditorKeys = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  const bg = theme.colors.overlayBackgroundColor || 'white';
  const fg = (theme.colors as { default?: string }).default || 'inherit';

  return (
    <Dialog
      isShown={isOpen}
      title="Edit word timing"
      onCloseComplete={() => dispatch(closeTimingEditor())}
      hasFooter={false}
      width={1100}
      preventBodyScrolling={false}
      shouldCloseOnOverlayClick
      shouldCloseOnEscapePress
      containerProps={{ backgroundColor: bg }}
      contentContainerProps={{ backgroundColor: bg }}
    >
      <div onKeyDown={trapEditorKeys} style={{ background: bg, color: fg, padding: 4, margin: -4 }}>
        {isOpen && timingEditor && <TimingEditorInner focusUuid={timingEditor.focusUuid} />}
      </div>
    </Dialog>
  );
}

function TimingEditorInner({ focusUuid }: { focusUuid: string }): JSX.Element {
  const theme = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 16);
    return () => clearTimeout(id);
  }, []);
  if (!mounted) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          color: theme.colors.muted,
          minHeight: WAVEFORM_HEIGHT + WORD_ROW_HEIGHT + 32,
        }}
      >
        Opening editor…
      </div>
    );
  }
  return <TimingEditorFull focusUuid={focusUuid} />;
}

function TimingEditorFull({ focusUuid }: { focusUuid: string }): JSX.Element {
  const dispatch = useDispatch();
  const theme = useTheme();
  const content = useSelector((state: RootState) => state.editor.present?.document.content);
  const sources = useSelector((state: RootState) => state.editor.present?.document.sources);

  const effectiveFocusUuid = useMemo(() => {
    if (!content) return focusUuid;
    if (content.find((x) => x.uuid === focusUuid && x.type === 'text')) return focusUuid;
    const oldIdx = content.findIndex((x) => x.uuid === focusUuid);
    const searchFrom = oldIdx >= 0 ? oldIdx : Math.floor(content.length / 2);
    for (let d = 0; d < content.length; d++) {
      for (const dir of [searchFrom + d, searchFrom - d]) {
        if (dir >= 0 && dir < content.length && content[dir].type === 'text') {
          return content[dir].uuid;
        }
      }
    }
    return focusUuid;
  }, [content, focusUuid]);

  const slice = useMemo(() => {
    if (!content) return null;
    return findParagraphSlice(content, effectiveFocusUuid);
  }, [content, effectiveFocusUuid]);

  const source = slice && sources ? sources[slice.sourceId] : undefined;
  const objectUrl = source?.objectUrl;
  const decode = useDecodedAudio(objectUrl);

  const peaksPerSec =
    decode.phase === 'done' ? decode.buffer.sampleRate / decode.peaks.samplesPerPeak : 0;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const wordInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLInputElement | null) => void>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(slice?.paragraphStart ?? 0);
  const [pendingFocusUuid, setPendingFocusUuid] = useState<string | null>(null);

  const [scrollLeft, setScrollLeft] = useState<number>(() => {
    if (!slice) return 0;
    const focus = slice.items.find((x) => x.uuid === focusUuid);
    if (!focus) return 0;
    const centerPx = (focus.sourceStart + focus.length / 2 - slice.paragraphStart) * PX_PER_SEC;
    return Math.max(0, centerPx - 500);
  });
  const [viewportWidth, setViewportWidth] = useState<number>(1000);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    setViewportWidth(c.clientWidth);
    setScrollLeft(c.scrollLeft);
    const onScroll = () => setScrollLeft(c.scrollLeft);
    c.addEventListener('scroll', onScroll, { passive: true });
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        c.scrollLeft += e.deltaY;
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportWidth(entry.contentRect.width);
    });
    ro.observe(c);
    return () => {
      c.removeEventListener('scroll', onScroll);
      c.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, []);

  const getInputRefCallback = useCallback((uuid: string) => {
    const existing = refCallbacks.current.get(uuid);
    if (existing) return existing;
    const cb = (el: HTMLInputElement | null) => {
      if (el) wordInputRefs.current.set(uuid, el);
      else wordInputRefs.current.delete(uuid);
    };
    refCallbacks.current.set(uuid, cb);
    return cb;
  }, []);

  useEffect(() => {
    if (!objectUrl) return;
    const audio = new Audio();
    audio.src = objectUrl;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, [objectUrl]);

  const didInitialCenterRef = useRef(false);
  useEffect(() => {
    if (didInitialCenterRef.current) return;
    if (!slice || !scrollRef.current) return;
    const focus = slice.items.find((x) => x.uuid === focusUuid);
    if (!focus) return;
    const centerPx = (focus.sourceStart + focus.length / 2 - slice.paragraphStart) * PX_PER_SEC;
    const container = scrollRef.current;
    const newScrollLeft = Math.max(0, centerPx - container.clientWidth / 2);
    container.scrollLeft = newScrollLeft;
    setScrollLeft(newScrollLeft);
    setPlayheadTime(focus.sourceStart);
    if (audioRef.current) audioRef.current.currentTime = focus.sourceStart;
    didInitialCenterRef.current = true;
  }, [slice, focusUuid]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      setPlayheadTime(a.currentTime);
      if (slice && a.currentTime >= slice.paragraphEnd) {
        a.pause();
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, slice]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !slice) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      if (a.currentTime < slice.paragraphStart || a.currentTime >= slice.paragraphEnd) {
        a.currentTime = slice.paragraphStart;
      }
      a.play();
      setPlaying(true);
    }
  }, [playing, slice]);

  useEffect(() => {
    if (!pendingFocusUuid) return;
    const el = wordInputRefs.current.get(pendingFocusUuid);
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      setPendingFocusUuid(null);
    }
  }, [pendingFocusUuid, slice]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [togglePlay]);

  type MergedItem =
    | (V3DocumentItem & { type: 'text' | 'non_text' })
    | {
        type: 'merged_silence';
        uuid: string;
        sourceStart: number;
        length: number;
        source: string;
        silenceUuids: string[];
      };

  const mergedItems = useMemo<MergedItem[]>(() => {
    if (!slice) return [];
    const result: MergedItem[] = [];
    for (const it of slice.items) {
      if (it.type === 'non_text') {
        const prev = result[result.length - 1];
        if (prev && (prev.type === 'non_text' || prev.type === 'merged_silence')) {
          const prevEnd = prev.sourceStart + prev.length;
          if (Math.abs(prevEnd - it.sourceStart) < 0.002 && prev.source === it.source) {
            if (prev.type === 'non_text') {
              result[result.length - 1] = {
                type: 'merged_silence',
                uuid: prev.uuid,
                sourceStart: prev.sourceStart,
                length: prev.length + it.length,
                source: prev.source,
                silenceUuids: [prev.uuid, it.uuid],
              };
            } else {
              prev.length += it.length;
              prev.silenceUuids.push(it.uuid);
            }
            continue;
          }
        }
      }
      result.push(it as MergedItem);
    }
    return result;
  }, [slice]);

  type Gap = { start: number; end: number; afterUuid: string };
  const gaps = useMemo<Gap[]>(() => {
    if (!slice || slice.items.length === 0) return [];
    const result: Gap[] = [];
    let currentEnd = slice.paragraphStart;
    let lastUuid = slice.items[0].uuid;
    for (const it of slice.items) {
      if (it.sourceStart > currentEnd + 0.002) {
        result.push({ start: currentEnd, end: it.sourceStart, afterUuid: lastUuid });
      }
      currentEnd = Math.max(currentEnd, it.sourceStart + it.length);
      lastUuid = it.uuid;
    }
    if (currentEnd < slice.paragraphEnd - 0.002) {
      result.push({ start: currentEnd, end: slice.paragraphEnd, afterUuid: lastUuid });
    }
    return result;
  }, [slice]);

  if (!slice) {
    return (
      <div style={{ padding: 20, color: theme.colors.muted }}>No words in this paragraph.</div>
    );
  }

  const durationSec = slice.paragraphEnd - slice.paragraphStart;
  const stripWidthPx = Math.ceil(durationSec * PX_PER_SEC);
  const playheadPx = (playheadTime - slice.paragraphStart) * PX_PER_SEC;

  const buffer = viewportWidth * 0.5;
  const visibleStartTime = slice.paragraphStart + Math.max(0, scrollLeft - buffer) / PX_PER_SEC;
  const visibleEndTime = slice.paragraphStart + (scrollLeft + viewportWidth + buffer) / PX_PER_SEC;

  const visibleItems = mergedItems.filter((it) => {
    const start = it.sourceStart;
    const end = it.sourceStart + it.length;
    return end >= visibleStartTime && start <= visibleEndTime;
  });

  const visibleGaps = gaps.filter((g) => g.end >= visibleStartTime && g.start <= visibleEndTime);

  const getDragBounds = (uuid: string) => {
    const idx = mergedItems.findIndex((x) => x.uuid === uuid);
    const prev = idx > 0 ? mergedItems[idx - 1] : null;
    const next = idx >= 0 && idx < mergedItems.length - 1 ? mergedItems[idx + 1] : null;
    const minStart = prev
      ? prev.sourceStart + (prev.type === 'text' ? MIN_WORD_LENGTH_S : 0)
      : slice.paragraphStart;
    const maxEnd = next
      ? next.sourceStart + next.length - (next.type === 'text' ? MIN_WORD_LENGTH_S : 0)
      : slice.paragraphEnd;
    return { minStart, maxEnd };
  };

  const onHandleDrag = (
    item: V3DocumentItem & { type: 'text' | 'non_text' },
    side: 'left' | 'right',
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const origStart = item.sourceStart;
    const origLength = item.length;
    const { minStart, maxEnd } = getDragBounds(item.uuid);
    const snapTargetTime = playheadTime;
    const snapPx = 10;
    const snapSec = snapPx / PX_PER_SEC;
    const move = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startClientX;
      const dxSec = dxPx / PX_PER_SEC;
      let newStart = origStart;
      let newLength = origLength;
      if (side === 'left') {
        let candidate = origStart + dxSec;
        if (Math.abs(candidate - snapTargetTime) < snapSec) candidate = snapTargetTime;
        newStart = Math.min(
          origStart + origLength - MIN_WORD_LENGTH_S,
          Math.max(minStart, candidate)
        );
        newLength = origStart + origLength - newStart;
      } else {
        let candidate = origStart + origLength + dxSec;
        if (Math.abs(candidate - snapTargetTime) < snapSec) candidate = snapTargetTime;
        const newEnd = Math.max(origStart + MIN_WORD_LENGTH_S, Math.min(maxEnd, candidate));
        newLength = newEnd - origStart;
      }
      dispatch(setWordTiming({ uuid: item.uuid, sourceStart: newStart, length: newLength }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onBlockDrag = (
    item: V3DocumentItem & { type: 'text' | 'non_text' },
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    const target = e.target as HTMLElement;
    if (target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const origStart = item.sourceStart;
    const origLength = item.length;
    const { minStart, maxEnd } = getDragBounds(item.uuid);
    const move = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / PX_PER_SEC;
      const newStart = Math.max(minStart, Math.min(maxEnd - origLength, origStart + dxSec));
      dispatch(setWordTiming({ uuid: item.uuid, sourceStart: newStart, length: origLength }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-word-block]') || t.closest('input') || t.closest('button')) {
      return;
    }

    const inner = e.currentTarget as HTMLDivElement;
    const rect = inner.getBoundingClientRect();

    const seekFromClientX = (clientX: number) => {
      const seekPx = clientX - rect.left;
      const time = slice.paragraphStart + Math.max(0, Math.min(durationSec, seekPx / PX_PER_SEC));
      setPlayheadTime(time);
      if (audioRef.current) audioRef.current.currentTime = time;
    };
    seekFromClientX(e.clientX);
    const move = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onTextCommit = (uuid: string, newText: string) => {
    dispatch(setWordText({ uuid, text: newText }));
  };

  const onDelete = (uuid: string) => {
    const idx = slice.items.findIndex((x) => x.uuid === uuid);
    let prevTextUuid: string | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (slice.items[i].type === 'text') {
        prevTextUuid = slice.items[i].uuid;
        break;
      }
    }
    if (!prevTextUuid) {
      for (let i = idx + 1; i < slice.items.length; i++) {
        if (slice.items[i].type === 'text') {
          prevTextUuid = slice.items[i].uuid;
          break;
        }
      }
    }
    dispatch(removeWord({ uuid }));
    if (prevTextUuid) {
      setPendingFocusUuid(prevTextUuid);
      setTimeout(() => centerOnUuid(prevTextUuid), 0);
    }
  };

  const centerOnUuid = (uuid: string) => {
    const item = slice.items.find((x) => x.uuid === uuid);
    if (!item) return;
    const c = scrollRef.current;
    if (!c) return;
    const centerPx = (item.sourceStart + item.length / 2 - slice.paragraphStart) * PX_PER_SEC;
    const target = Math.max(0, centerPx - c.clientWidth / 2);
    c.scrollLeft = target;
    setScrollLeft(target);
  };

  const onArrowPointerDown = (direction: 1 | -1) => (e: React.PointerEvent) => {
    e.preventDefault();
    const c = scrollRef.current;
    if (!c) return;
    c.scrollLeft = Math.max(0, c.scrollLeft + (direction * PX_PER_SEC) / 2);

    let holdTimer: number | null = null;
    let rafId: number | null = null;

    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      const startT = performance.now();
      let lastT = startT;
      const tick = (t: number) => {
        const dt = (t - lastT) / 1000;
        lastT = t;
        const elapsed = (t - startT) / 1000;
        const speed = PX_PER_SEC * 2 * (1 + Math.min(4, elapsed * 2));
        c.scrollLeft = Math.max(0, c.scrollLeft + direction * speed * dt);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }, 300);

    const stop = () => {
      if (holdTimer != null) clearTimeout(holdTimer);
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const atStart = scrollLeft <= 0;
  const atEnd = scrollLeft + viewportWidth >= stripWidthPx - 1;

  const onWordKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    item: V3DocumentItem & { type: 'text' }
  ) => {
    if (e.key === 'Enter') {
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onDelete(item.uuid);
      return;
    }
    if (
      e.key === 'Backspace' &&
      e.currentTarget.value === '' &&
      (e.currentTarget.selectionStart ?? 0) === 0
    ) {
      e.preventDefault();
      onDelete(item.uuid);
      return;
    }
  };

  const fillColor = theme.colors.playAccent;
  const midLineColor =
    theme.colors.border && (theme.colors.border as any).default
      ? (theme.colors.border as any).default
      : 'rgba(127,127,127,0.4)';
  const waveformReady = decode.phase === 'done';
  const tileCount = waveformReady ? Math.ceil(stripWidthPx / CANVAS_TILE_PX) : 0;

  return (
    <div>
      <Toolbar style={{ color: theme.colors.default || 'inherit' }}>
        <PlayButton
          onClick={togglePlay}
          style={{ background: theme.colors.playAccent }}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <PauseIcon size={14} color="white" /> : <PlayIcon size={14} color="white" />}
        </PlayButton>
        {decode.phase === 'decoding' && (
          <span style={{ fontSize: 12, color: theme.colors.muted }}>Decoding audio…</span>
        )}
        {decode.phase === 'building' && (
          <>
            <span style={{ fontSize: 12, color: theme.colors.muted }}>
              Building waveform {Math.round(decode.progress * 100)}%
            </span>
            <ProgressBarTrack style={{ background: theme.colors.muted }}>
              <ProgressBarFill
                fraction={decode.progress}
                style={{ background: theme.colors.playAccent }}
              />
            </ProgressBarTrack>
          </>
        )}
        {decode.phase === 'done' && (
          <span style={{ fontSize: 12, color: theme.colors.muted }}>
            Click/drag empty area to seek &nbsp;·&nbsp; Drag handles to retime &nbsp;·&nbsp; Type in
            a word to edit; space splits
          </span>
        )}
        {decode.phase === 'error' && (
          <span style={{ fontSize: 12, color: theme.colors.playAccent }}>
            Audio decode error: {decode.error}
          </span>
        )}
      </Toolbar>

      <StripScrollRow>
        <ArrowButton
          disabled={atStart}
          onPointerDown={onArrowPointerDown(-1)}
          title="Hold to scroll left"
          aria-label="Scroll left"
          style={{
            borderColor: theme.colors.border?.default || '#888',
            background: theme.colors.overlayBackgroundColor,
            color: theme.colors.default || 'inherit',
          }}
        >
          ‹
        </ArrowButton>
        <StripScrollContainer
          ref={scrollRef}
          style={{
            background: theme.colors.overlayBackgroundColor,
            borderColor: theme.colors.border?.default || '#888',
          }}
        >
          <StripInner widthPx={stripWidthPx} onPointerDown={onStripPointerDown}>
            {waveformReady ? (
              <WaveformLayer>
                {Array.from({ length: tileCount }, (_, i) => {
                  const tileLeftPx = i * CANVAS_TILE_PX;
                  const tileWidthPx = Math.min(CANVAS_TILE_PX, stripWidthPx - tileLeftPx);
                  const tileStartTime = slice.paragraphStart + tileLeftPx / PX_PER_SEC;
                  return (
                    <WaveformTile
                      key={i}
                      peaks={(decode as { peaks: Peaks }).peaks}
                      peaksPerSec={peaksPerSec}
                      tileStartTime={tileStartTime}
                      pxPerSec={PX_PER_SEC}
                      tileWidthPx={tileWidthPx}
                      height={WAVEFORM_HEIGHT}
                      fillColor={fillColor}
                      midLineColor={midLineColor}
                    />
                  );
                })}
              </WaveformLayer>
            ) : (
              <WaveformPlaceholder style={{ color: theme.colors.muted }}>
                {decode.phase === 'error'
                  ? `decode error: ${decode.error}`
                  : decode.phase === 'building'
                  ? `building waveform ${Math.round(decode.progress * 100)}%`
                  : 'decoding audio…'}
              </WaveformPlaceholder>
            )}

            <WordRow>
              {visibleItems.map((it) => {
                const leftPx = (it.sourceStart - slice.paragraphStart) * PX_PER_SEC;
                const widthPx = Math.max(2, it.length * PX_PER_SEC);
                if (it.type === 'non_text' || it.type === 'merged_silence') {
                  const handleSilenceDblClick = (e: React.MouseEvent) => {
                    if (it.length < 0.02) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const clickFrac = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width)
                    );
                    const clickTime = it.sourceStart + clickFrac * it.length;

                    let targetUuid = it.uuid;
                    let targetStart = it.sourceStart;
                    let targetLength = it.length;
                    if (it.type === 'merged_silence') {
                      for (const uid of it.silenceUuids) {
                        const si = slice.items.find((x) => x.uuid === uid);
                        if (si && si.type === 'non_text') {
                          const siEnd = si.sourceStart + si.length;
                          if (clickTime >= si.sourceStart && clickTime <= siEnd) {
                            targetUuid = si.uuid;
                            targetStart = si.sourceStart;
                            targetLength = si.length;
                            break;
                          }
                        }
                      }
                    }
                    const insertLength = Math.min(0.25, Math.max(0.08, targetLength * 0.4));
                    const insertTime = Math.max(
                      targetStart,
                      Math.min(
                        targetStart + targetLength - insertLength,
                        clickTime - insertLength / 2
                      )
                    );
                    const newWordUuid = uuidv4();
                    dispatch(
                      insertWordIntoSilence({
                        silenceUuid: targetUuid,
                        insertTime,
                        insertLength,
                        newWordUuid,
                        text: '',
                      })
                    );
                    setPendingFocusUuid(newWordUuid);
                  };
                  return (
                    <SilenceBlock
                      key={it.uuid}
                      style={{ left: leftPx, width: widthPx }}
                      title="Double-click to insert a new word here"
                      onDoubleClick={handleSilenceDblClick}
                    />
                  );
                }
                const isFocus = it.uuid === focusUuid;
                return (
                  <WordBlock
                    key={it.uuid}
                    data-word-block="1"
                    title={it.text}
                    style={{
                      left: leftPx,
                      width: widthPx,
                      borderColor: isFocus
                        ? 'rgba(80, 140, 220, 0.8)'
                        : theme.colors.border?.default || '#888',
                      background: isFocus
                        ? 'rgba(80, 140, 220, 0.15)'
                        : 'rgba(127, 127, 127, 0.10)',
                      color: theme.colors.default || 'inherit',
                    }}
                    onPointerDown={(e) => onBlockDrag(it, e)}
                  >
                    <Handle
                      side="left"
                      style={{
                        background: `linear-gradient(to right, ${theme.colors.playAccent}, transparent)`,
                      }}
                      onPointerDown={(e) => onHandleDrag(it, 'left', e)}
                    />
                    <WordText
                      style={{ color: theme.colors.default || 'inherit' }}
                      defaultValue={it.text}
                      ref={getInputRefCallback(it.uuid)}
                      onBlur={(e) => onTextCommit(it.uuid, e.currentTarget.value)}
                      onClick={() => centerOnUuid(it.uuid)}
                      onKeyDown={(e) => onWordKeyDown(e, it as V3DocumentItem & { type: 'text' })}
                    />
                    <Handle
                      side="right"
                      style={{
                        background: `linear-gradient(to left, ${theme.colors.playAccent}, transparent)`,
                      }}
                      onPointerDown={(e) => onHandleDrag(it, 'right', e)}
                    />
                  </WordBlock>
                );
              })}
              {visibleGaps.map((gap, gi) => {
                const leftPx = (gap.start - slice.paragraphStart) * PX_PER_SEC;
                const widthPx = Math.max(2, (gap.end - gap.start) * PX_PER_SEC);
                return (
                  <GapBlock
                    key={`gap-${gi}`}
                    style={{
                      left: leftPx,
                      width: widthPx,
                      borderColor: theme.colors.border?.default || '#888',
                    }}
                    title="Double-click to insert a new word here"
                    onDoubleClick={() => {
                      const gapLength = gap.end - gap.start;
                      const insertLength = Math.min(0.25, Math.max(0.08, gapLength * 0.4));
                      const insertTime = gap.start + (gapLength - insertLength) / 2;
                      const newWordUuid = uuidv4();
                      dispatch(
                        insertWordInGap({
                          afterItemUuid: gap.afterUuid,
                          source: slice.sourceId,
                          gapStart: gap.start,
                          gapEnd: gap.end,
                          insertTime,
                          insertLength,
                          newWordUuid,
                          text: '',
                        })
                      );
                      setPendingFocusUuid(newWordUuid);
                    }}
                  />
                );
              })}
            </WordRow>

            <Playhead
              style={{ left: playheadPx, borderLeft: `2px solid ${theme.colors.playAccent}` }}
            />
          </StripInner>
        </StripScrollContainer>
        <ArrowButton
          disabled={atEnd}
          onPointerDown={onArrowPointerDown(1)}
          title="Hold to scroll right"
          aria-label="Scroll right"
          style={{
            borderColor: theme.colors.border?.default || '#888',
            background: theme.colors.overlayBackgroundColor,
            color: theme.colors.default || 'inherit',
          }}
        >
          ›
        </ArrowButton>
      </StripScrollRow>

      <Hint style={{ color: theme.colors.muted }}>
        Double-click a gap to add a word. Drag a word block to move it; drag its edge handles to
        retime. Ctrl/Cmd+Backspace inside a word deletes it (or empty its text and press Backspace).
        All changes are clamped to neighbouring words.
      </Hint>
    </div>
  );
}

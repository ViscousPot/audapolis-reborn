import * as React from 'react';
import { HTMLAttributes, HTMLProps, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  V3Paragraph as ParagraphType,
  TimedItemExtension,
  V3TimedParagraphItem,
  V3TimedParagraph,
} from '../../core/document';
import { majorScale, Pane, PaneProps, Text } from 'evergreen-ui';
import { reassignParagraph, renameSpeaker } from '../../state/editor/edit';
import { memoizedRetakeHighlights } from '../../state/editor/retakes';

import { RootState } from '../../state';
import { useTheme } from '../../components/theme';
import { Selection } from '../../state/editor/types';
import {
  abortTranscriptCorrection,
  finishTranscriptCorrection,
  setTranscriptCorrectionText,
} from '../../state/editor/transcript_correction';
import { assertSome } from '../../util';
import { MenuItem, showContextMenu } from '../../components/Menu';
import styled from 'styled-components';

export function Paragraph({
  data,
  color,
  displaySpeakerNames,
  paraBreakIdx,
  paraBreakUuid,
  editingRange,
}: {
  data: V3TimedParagraph;
  color: string;
  displaySpeakerNames: boolean;
  paraBreakIdx: number;
  paraBreakUuid: string;
  editingRange: Selection | null;
}): JSX.Element {
  const theme = useTheme();

  const displayConfidence = useSelector(
    (state: RootState) => state.editor.present?.displayConfidence || false
  );
  const displayRetakes = useSelector(
    (state: RootState) => state.editor.present?.displayRetakes || false
  );
  const silenceRemovalActive = useSelector(
    (state: RootState) => state.editor.present?.silenceRemovalActive || false
  );
  const silenceThreshold = useSelector(
    (state: RootState) => state.editor.present?.silenceThreshold ?? 0.4
  );
  const documentContent = useSelector(
    (state: RootState) => state.editor.present?.document.content
  );
  const retakeHighlights = React.useMemo(() => {
    if (!displayRetakes || !documentContent) return null;
    return memoizedRetakeHighlights(documentContent);
  }, [displayRetakes, documentContent]);

  return (
    <Pane display={'flex'} flexDirection={'row'} marginBottom={majorScale(2)}>
      <Speaker
        name={data.speaker}
        paragraphEndAbsoluteIndex={data.absoluteIndex}
        color={color.toString()}
        width={displaySpeakerNames ? 150 : 0}
        transition={'width 0.2s'}
        flexShrink={0}
        marginRight={majorScale(1)}
      />
      <span key={data.uuid} id={`item-${data.uuid}`} />
      <Pane color={displaySpeakerNames ? color : theme.colors.default} transition={'color 0.5s'}>
        {data.content.map((item, i) => {
          const commonProps = {
            key: item.uuid,
            id: `item-${item.uuid}`,
          };
          if (editingRange && editingRange.startIndex == item.absoluteIndex) {
            return <TranscriptCorrectionEntry {...commonProps} />;
          } else if (
            editingRange &&
            editingRange.startIndex <= item.absoluteIndex &&
            editingRange.startIndex + editingRange.length > item.absoluteIndex
          ) {
            return; // we are handling the rendering in the first element
          } else if (
            silenceRemovalActive &&
            (item.type === 'non_text' || item.type === 'artificial_silence') &&
            item.length > silenceThreshold
          ) {
            return <span {...commonProps} style={{ display: 'none' }} />;
          } else {
            const preserve = i == 0 || i == data.content.length - 1;
            // Resolve retake highlight for this item. Bridge across silences:
            // if a silence sits between two same-kind highlighted text items,
            // colour it too so the bar is visually continuous.
            let retakeKind: 'discard' | 'keep' | undefined;
            if (retakeHighlights) {
              if (item.type === 'text') {
                retakeKind = retakeHighlights[item.uuid];
              } else if (item.type === 'non_text' || item.type === 'artificial_silence') {
                const prev = data.content[i - 1];
                const next = data.content[i + 1];
                if (prev && next && prev.type === 'text' && next.type === 'text') {
                  const pK = retakeHighlights[prev.uuid];
                  const nK = retakeHighlights[next.uuid];
                  if (pK && pK === nK) retakeKind = pK;
                }
              }
            }
            return renderParagraphItem(
              item,
              displayConfidence,
              commonProps,
              preserve,
              retakeKind,
              silenceThreshold
            );
          }
        })}
        <ParagraphSign
          key={data.content.length}
          id={`item-${paraBreakUuid}`}
          data={data}
          paraBreakIdx={paraBreakIdx}
        />
      </Pane>
    </Pane>
  );
}

function renderParagraphItem(
  item: V3TimedParagraphItem,
  displayConfidence: boolean,
  commonProps: HTMLProps<HTMLSpanElement>,
  preserve: boolean,
  retakeKind: 'discard' | 'keep' | undefined,
  silenceThreshold: number
): JSX.Element {
  if (item.type == 'text') {
    let bgColor: string | undefined;
    if (retakeKind === 'discard') bgColor = 'rgba(232, 80, 70, 0.42)';
    else if (retakeKind === 'keep') bgColor = 'rgba(70, 195, 110, 0.40)';
    else if (displayConfidence) bgColor = `rgba(255, 0, 0, ${1 - item.conf})`;

    // Highlight (incl. leading space) on the outer span so adjacent same-kind
    // words render as one continuous bar instead of separate pills.
    if (bgColor !== undefined) {
      return (
        <span {...commonProps} style={{ backgroundColor: bgColor }}>
          {' ' + item.text}
        </span>
      );
    }
    return <span {...commonProps}>{' ' + item.text}</span>;
  } else if (item.type == 'non_text' || item.type == 'artificial_silence') {
    let bgColor: string | undefined;
    if (retakeKind === 'discard') bgColor = 'rgba(232, 80, 70, 0.42)';
    else if (retakeKind === 'keep') bgColor = 'rgba(70, 195, 110, 0.40)';
    if (item.length > silenceThreshold) {
      return (
        <span
          style={{
            fontFamily: 'quarter_rest',
            ...(bgColor !== undefined && { backgroundColor: bgColor }),
          }}
          {...commonProps}
        >
          {' _'}
        </span>
      );
    } else {
      return (
        <span
          style={{
            ...(preserve && { whiteSpace: 'pre' }),
            ...(bgColor !== undefined && { backgroundColor: bgColor }),
          }}
          {...commonProps}
        >
          {' '}
        </span>
      );
    }
  } else {
    throw Error(`unknown paragraph-item '${item}'`);
  }
}

function TranscriptCorrectionEntry(props: HTMLProps<HTMLSpanElement>): JSX.Element {
  const editingState = useSelector(
    (state: RootState) => state.editor.present?.transcriptCorrectionState
  );
  const dispatch = useDispatch();
  const focusDocument = () => {
    const el = document.getElementById('document');
    el?.focus();
  };

  return (
    <span {...props}>
      {' '}
      <span
        tabIndex={0}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key == 'Enter') {
            dispatch(setTranscriptCorrectionText(e.currentTarget.innerHTML));
            dispatch(finishTranscriptCorrection());
            focusDocument();
            e.preventDefault();
          } else if (e.key == 'Escape') {
            dispatch(abortTranscriptCorrection());
            e.preventDefault();
            focusDocument();
          }

          e.stopPropagation();
        }}
        contentEditable={true}
        suppressContentEditableWarning={true}
        onBlur={() => {
          dispatch(abortTranscriptCorrection());
          focusDocument();
        }}
        ref={(ref) => {
          if (ref)
            setTimeout(() => {
              const range = document.createRange();
              range.selectNodeContents(ref);
              const sel = window.getSelection();
              assertSome(sel);
              sel.removeAllRanges();
              sel.addRange(range);
              ref?.focus();
            });
        }}
      >
        {editingState}
      </span>
    </span>
  );
}

function ParagraphSign({
  paraBreakIdx,
  data,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  paraBreakIdx: number;
  data: ParagraphType & TimedItemExtension;
}): JSX.Element {
  const theme = useTheme();
  const selection = useSelector((state: RootState) => state.editor.present?.selection);
  const showParSign =
    data.content.length == 0 ||
    (selection !== null &&
      selection !== undefined &&
      selection.startIndex <= paraBreakIdx &&
      selection.startIndex + selection.length > paraBreakIdx);
  return (
    <span style={{ color: theme.colors.muted }} {...props}>
      {showParSign ? ' ¶' : ''}
    </span>
  );
}

enum EditingType {
  Reassign,
  Rename,
}
type SpeakerEditing = null | {
  type: EditingType;
  currentText: string;
  isNew: boolean;
};

const SpeakerEditInput = styled.input`
  padding: 0;
  margin: 0;
  border: none;
  outline: none;

  font-family: 'SF UI Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
    sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
  font-size: 14px;
`;

function Speaker({
  name,
  paragraphEndAbsoluteIndex,
  color,
  ...props
}: PaneProps & {
  name: string | null;
  paragraphEndAbsoluteIndex: number;
}): JSX.Element {
  const [editing, setEditing] = useState(null as SpeakerEditing);
  const dispatch = useDispatch();

  const onContextMenu = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    showContextMenu(
      <>
        <MenuItem
          label={'Rename Speaker'}
          callback={() =>
            setEditing({ isNew: true, type: EditingType.Rename, currentText: name || '' })
          }
        />
        <MenuItem
          label={'Reassign Speaker'}
          callback={() =>
            setEditing({ isNew: true, type: EditingType.Reassign, currentText: name || '' })
          }
        />
      </>
    );
  };

  if (!editing) {
    return (
      <Pane
        {...props}
        textOverflow={'ellipsis'}
        overflow={'hidden'}
        whiteSpace={'nowrap'}
        userSelect={'none'}
      >
        <Text
          maxWidth={props.width}
          paddingRight={majorScale(2)}
          display={'inline-block'}
          color={color}
          onContextMenu={onContextMenu}
          onClick={onContextMenu}
        >
          {name || 'click to set speaker'}
        </Text>
      </Pane>
    );
  } else {
    return (
      <Pane {...props}>
        <SpeakerEditInput
          placeholder={'Enter speaker name'}
          value={editing.currentText}
          ref={(ref: HTMLInputElement) => {
            if (editing.isNew) {
              ref?.focus();
              ref?.select();
              setEditing({ ...editing, isNew: false });
            }
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key == 'Enter') {
              if (editing.type == EditingType.Reassign) {
                dispatch(
                  reassignParagraph({
                    absoluteIndex: paragraphEndAbsoluteIndex,
                    newSpeaker: editing.currentText,
                  })
                );
              } else if (editing.type == EditingType.Rename) {
                dispatch(renameSpeaker({ oldName: name, newName: editing.currentText }));
              }
              setEditing(null);
            } else if (e.key == 'Escape') {
              setEditing(null);
            }
          }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEditing({ ...editing, currentText: e.target.value });
          }}
          onBlur={() => {
            //setEditing(null);
          }}
        />
      </Pane>
    );
  }
}

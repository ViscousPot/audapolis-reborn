import * as React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../state';
import { TitleBar, TitleBarGroup, TitleBarSection } from '../../components/TitleBar';
import styled, { keyframes } from 'styled-components';
import { ActionCreators } from 'redux-undo';
import {
  Checkbox,
  CleanIcon,
  Dialog,
  ExportIcon,
  FilmIcon,
  FloppyDiskIcon,
  GraphRemoveIcon,
  IconButton,
  IconButtonProps,
  HighlightIcon,
  Pane,
  Paragraph,
  PersonIcon,
  RedoIcon,
  Tooltip,
  UndoIcon,
  Text,
  PlayIcon,
  PauseIcon,
  majorScale,
  PaneProps,
  Button,
  EraserIcon,
  MinimizeIcon,
} from 'evergreen-ui';
import { ForwardedRef, useState } from 'react';
import {
  setExportPopup,
  toggleDisplaySpeakerNames,
  toggleDisplayVideo,
} from '../../state/editor/display';
import { enhanceSource, toggleEnhancement } from '../../state/editor/enhance';
import { toggleDisplayRetakes } from '../../state/editor/retakes';
import { closeDocument, saveDocument } from '../../state/editor/io';
import { removeRetakes } from '../../state/editor/retakes';
import { removeAllSilences } from '../../state/editor/silence_removal';
import { setPlay } from '../../state/editor/play';
import { useTheme } from '../../components/theme';
import { Circle } from 'rc-progress';
import { currentCursorTime, memoizedParagraphItems } from '../../state/editor/selectors';

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const ShimmerWrap = styled.div`
  animation: ${pulse} 1.8s ease-in-out infinite;
  display: flex;
  align-items: center;
`;

function ProgressButton({
  progress,
  disabled,
  tooltip = '',
}: {
  progress: number;
  disabled: boolean;
  tooltip?: string;
}) {
  if (tooltip == null) {
    tooltip = `${Math.round(progress * 100)}%`;
  }
  return (
    <Tooltip content={tooltip}>
      <Button padding={0} appearance={'minimal'} disabled={disabled}>
        <ShimmerWrap>
          <Circle
            style={{ height: majorScale(3) }}
            percent={progress * 100}
            strokeWidth={50}
            trailWidth={0}
            strokeLinecap={'butt'}
          />
        </ShimmerWrap>
      </Button>
    </Tooltip>
  );
}
function EnhanceDialog({
  isShown,
  onClose,
}: {
  isShown: boolean;
  onClose: () => void;
}): JSX.Element {
  const dispatch = useDispatch();
  const [useVad, setUseVad] = useState(true);
  const sources = useSelector(
    (state: RootState) => state.editor.present?.document.sources
  ) || {};
  const enhanceState = useSelector(
    (state: RootState) => state.editor.present?.enhanceState
  ) || { running: false, progress: 0 };
  const theme = useTheme();

  const sourceEntries = Object.entries(sources);
  const sourceHash = sourceEntries.length > 0 ? sourceEntries[0][0] : null;
  const isEnhanced = sourceHash ? !!sources[sourceHash].enhancedFileContents : false;

  return (
    <Dialog
      isShown={isShown}
      title="Enhance Audio"
      onCloseComplete={onClose}
      containerProps={{ backgroundColor: theme.colors.overlayBackgroundColor }}
      hasFooter={false}
    >
      {enhanceState.running ? (
        <Pane display="flex" flexDirection="column" alignItems="center" paddingY={majorScale(3)}>
          <ShimmerWrap>
            <Circle
              style={{ height: 60, width: 60 }}
              percent={enhanceState.progress * 100}
              strokeWidth={8}
              strokeLinecap={'round'}
            />
          </ShimmerWrap>
          <Text marginTop={majorScale(2)}>
            {enhanceState.progress < 0.2 ? 'Loading model...' : 'Processing audio...'}
          </Text>
        </Pane>
      ) : isEnhanced ? (
        <Pane paddingY={majorScale(1)}>
          <Paragraph marginBottom={majorScale(2)}>
            Audio has been enhanced. Use the toolbar toggle to switch between enhanced and original.
          </Paragraph>
          <Pane display="flex" gap={majorScale(1)}>
            <Button
              onClick={() => {
                if (sourceHash) dispatch(toggleEnhancement(sourceHash));
                onClose();
              }}
            >
              Revert to original
            </Button>
            <Button appearance="primary" onClick={onClose}>
              Continue
            </Button>
          </Pane>
        </Pane>
      ) : (
        <Pane paddingY={majorScale(1)}>
          <Paragraph marginBottom={majorScale(2)}>
            Clean up audio using speech enhancement. This removes background noise and improves
            clarity.
          </Paragraph>
          <Checkbox
            label="Use VAD preprocessing"
            checked={useVad}
            onChange={(e) => setUseVad(e.target.checked)}
            marginBottom={majorScale(2)}
          />
          <Button
            appearance="primary"
            disabled={!sourceHash}
            onClick={() => {
              if (sourceHash) dispatch(enhanceSource({ sourceHash, useVad }));
            }}
          >
            Enhance
          </Button>
        </Pane>
      )}
    </Dialog>
  );
}

export function EditorTitleBar(): JSX.Element {
  const dispatch = useDispatch();
  const displaySpeakerNames =
    useSelector(
      (state: RootState) => state.editor.present?.document.metadata.display_speaker_names
    ) || false;
  const displayVideo =
    useSelector((state: RootState) => state.editor.present?.document.metadata.display_video) ||
    false;
  const displayRetakes =
    useSelector((state: RootState) => state.editor.present?.displayRetakes) || false;
  const canUndo = useSelector((state: RootState) => state.editor.past.length > 0);
  const canRedo = useSelector((state: RootState) => state.editor.future.length > 0);
  const canSave = useSelector(
    (state: RootState) => state.editor.present?.document != state.editor.present?.lastSavedDocument
  );

  const canExport = useSelector(
    (state: RootState) =>
      state.editor.present?.document.content != undefined &&
      memoizedParagraphItems(state.editor.present?.document.content).length > 0
  );

  const exportState = useSelector(
    (state: RootState) => state.editor.present?.exportState || { running: false, progress: 0 }
  );
  const enhanceState = useSelector(
    (state: RootState) => state.editor.present?.enhanceState || { running: false, progress: 0 }
  );
  const sources = useSelector(
    (state: RootState) => state.editor.present?.document.sources
  ) || {};
  const firstSourceHash = Object.keys(sources)[0] ?? null;
  const isEnhanced = firstSourceHash ? !!sources[firstSourceHash]?.enhancedFileContents : false;
  const enhancedActive = firstSourceHash ? !!sources[firstSourceHash]?.enhancedActive : false;

  const exportDisabled = exportState.running || !canExport;
  const [enhanceDialogShown, setEnhanceDialogShown] = useState(false);
  return (
    <TitleBar>
      <TitleBarSection>
        <TitleBarGroup>
          <Tooltip content={'undo'}>
            <TitleBarButton
              disabled={!canUndo}
              icon={UndoIcon}
              onClick={() => dispatch(ActionCreators.undo())}
            />
          </Tooltip>
          <Tooltip content={'redo'}>
            <TitleBarButton
              icon={RedoIcon}
              disabled={!canRedo}
              onClick={() => dispatch(ActionCreators.redo())}
            />
          </Tooltip>
          <Tooltip content={'remove long silences'}>
            <TitleBarButton
              icon={EraserIcon}
              onClick={() => dispatch(removeAllSilences())}
            />
          </Tooltip>
          <Tooltip content={'remove retakes'}>
            <TitleBarButton
              icon={GraphRemoveIcon}
              onClick={() => dispatch(removeRetakes())}
            />
          </Tooltip>
        </TitleBarGroup>
        <TitleBarGroup>
          <Tooltip content={displaySpeakerNames ? 'hide speaker names' : 'display speaker names'}>
            <TitleBarButton
              icon={PersonIcon}
              isActive={displaySpeakerNames}
              onClick={() => dispatch(toggleDisplaySpeakerNames())}
            />
          </Tooltip>
          <Tooltip content={displayVideo ? 'hide video' : 'display video'}>
            <TitleBarButton
              icon={FilmIcon}
              isActive={displayVideo}
              onClick={() => dispatch(toggleDisplayVideo())}
            />
          </Tooltip>
          <Tooltip content={displayRetakes ? 'hide retake highlights' : 'highlight retakes'}>
            <TitleBarButton
              icon={HighlightIcon}
              isActive={displayRetakes}
              onClick={() => dispatch(toggleDisplayRetakes())}
            />
          </Tooltip>
          {enhanceState.running ? (
            <ProgressButton progress={enhanceState.progress} disabled={true} tooltip="enhancing audio..." />
          ) : isEnhanced ? (
            <Tooltip content={enhancedActive ? 'using enhanced audio' : 'using original audio'}>
              <TitleBarButton
                icon={CleanIcon}
                isActive={enhancedActive}
                onClick={() => {
                  if (firstSourceHash) dispatch(toggleEnhancement(firstSourceHash));
                }}
              />
            </Tooltip>
          ) : (
            <Tooltip content={'enhance audio'}>
              <TitleBarButton
                icon={CleanIcon}
                onClick={() => setEnhanceDialogShown(true)}
              />
            </Tooltip>
          )}
        </TitleBarGroup>
        <EnhanceDialog
          isShown={enhanceDialogShown}
          onClose={() => setEnhanceDialogShown(false)}
        />
      </TitleBarSection>

      <PlayerControls id={'player-controls' /* for joyride */} />

      <TitleBarSection>
        <TitleBarGroup>
          <Tooltip content={'save document'}>
            <TitleBarButton
              icon={FloppyDiskIcon}
              disabled={!canSave}
              onClick={() => dispatch(saveDocument(false))}
            />
          </Tooltip>
          {exportState.running ? (
            <ProgressButton progress={exportState.progress} disabled={exportDisabled} />
          ) : (
            <Tooltip content={'export document'}>
              <TitleBarButton
                id={'export'}
                icon={ExportIcon}
                disabled={exportDisabled}
                onClick={() => dispatch(setExportPopup('document'))}
              />
            </Tooltip>
          )}
          <Tooltip content={'close document'}>
            <TitleBarButton
              icon={MinimizeIcon}
              onClick={() => dispatch(closeDocument())}
            />
          </Tooltip>
        </TitleBarGroup>
      </TitleBarSection>
    </TitleBar>
  );
}

const TitleBarButton = React.forwardRef(function titleBarButton(
  props: IconButtonProps,
  ref: ForwardedRef<HTMLButtonElement>
) {
  return <IconButton ref={ref} borderRadius={8} appearance={'minimal'} iconSize={16} {...props} />;
});

function PlayerControls(props: PaneProps) {
  const time = useSelector((state: RootState) =>
    state.editor.present ? currentCursorTime(state.editor.present) : 0
  );
  const formatInt = (x: number) => {
    const str = Math.floor(x).toString();
    return (str.length == 1 ? '0' + str : str).substr(0, 2);
  };
  const playing = useSelector((state: RootState) => state.editor.present?.playing);
  const dispatch = useDispatch();

  const theme = useTheme();

  return (
    <Pane
      borderRadius={8}
      border={'default'}
      height={30}
      width={200}
      display={'flex'}
      flexDirection={'row'}
      alignItems={'center'}
      justifyContent={'center'}
      style={{ WebkitAppRegion: 'no-drag' }}
      {...props}
    >
      <Text marginRight={majorScale(2)} style={{ fontVariantNumeric: 'tabular-nums' }} size={500}>
        {formatInt(time / 60)}:{formatInt(time % 60)}:{formatInt((time * 100) % 100)}
      </Text>
      <PlayIcon
        color={playing ? theme.colors.playAccent : 'default'}
        onClick={() => dispatch(setPlay(true))}
        size={19}
      />
      <PauseIcon
        color={playing ? 'default' : theme.colors.playAccent}
        onClick={() => dispatch(setPlay(false))}
        size={19}
      />
    </Pane>
  );
}

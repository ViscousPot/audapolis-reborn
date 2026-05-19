import * as React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../state';
import styled from 'styled-components';
import { player } from '../../core/player';
import { getActiveObjectUrl } from '../../core/document';
import { Card, FilmIcon, Pane } from 'evergreen-ui';
import { CrossedOutIcon } from '../../components/Util';
import { currentIndex } from '../../state/editor/selectors';

const MIN_WIDTH = 200;
const MAX_WIDTH = 1200;
const ASPECT_RATIO = 16 / 9;
const DEFAULT_WIDTH = 300;

const PlayerContainer = styled.div<{ visible: boolean }>`
  position: absolute;
  bottom: ${({ visible }) => (visible ? 0 : -100)}%;
  transition: bottom 0.3s;
  right: 0;
  display: block;
`;

const PlayerInner = styled.div`
  position: relative;
  margin: 15px 30px;
`;

const StyledPane = styled(Pane)`
  border-radius: 8px;
  overflow: hidden;
`;

const VideoTag = styled.video<{ visible: boolean }>`
  width: 100%;
  height: 100%;
  display: ${({ visible }) => (visible ? 'block' : 'none')};
  position: relative;
  z-index: 2;
  object-fit: contain;
`;

const FallbackVideoTag = styled.div<{ visible: boolean }>`
  width: 100%;
  height: 100%;
  display: ${({ visible }) => (visible ? 'block' : 'none')};
  position: relative;
  z-index: 2;
`;

const ResizeHandle = styled.div`
  position: absolute;
  top: -8px;
  left: -8px;
  width: 28px;
  height: 28px;
  cursor: nwse-resize;
  z-index: 20;

  &::before {
    content: '';
    position: absolute;
    top: 8px;
    left: 8px;
    width: 8px;
    height: 8px;
    border-top: 2px solid rgba(255, 255, 255, 0.6);
    border-left: 2px solid rgba(255, 255, 255, 0.6);
  }

  &:hover::before {
    border-color: #fff;
  }
`;

export function Player(): JSX.Element {
  const sources = useSelector((state: RootState) => state.editor.present?.document.sources) || {};
  const currentSource = useSelector((state: RootState) => {
    if (!state.editor.present) {
      return null;
    }
    let cIdx = currentIndex(state.editor.present);
    let cItem = state.editor.present.document.content[cIdx];
    if (cIdx > 0 && cItem && cItem.type == 'paragraph_end') {
      cIdx -= 1;
      cItem = state.editor.present.document.content[cIdx];
    }
    return cItem && 'source' in cItem ? cItem.source : null;
  });
  const displayVideo =
    useSelector((state: RootState) => state.editor.present?.document.metadata.display_video) ||
    false;

  const [width, setWidth] = React.useState(DEFAULT_WIDTH);
  const widthRef = React.useRef(DEFAULT_WIDTH);
  const dragState = React.useRef<{
    startX: number;
    startY: number;
    startWidth: number;
  } | null>(null);

  const onHandlePointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: widthRef.current,
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const delta = Math.abs(dx) > Math.abs(dy) ? -dx : -dy;
      let newWidth = dragState.current.startWidth + delta;
      newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(newWidth)));
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  return (
    <PlayerContainer
      visible={displayVideo}
      style={{
        width: `${width}px`,
        height: `${width / ASPECT_RATIO}px`,
      }}
    >
      <PlayerInner>
        <StyledPane position={'relative'}>
          <Card
            position={'absolute'}
            top={0}
            left={0}
            display={'flex'}
            justifyContent={'center'}
            alignItems={'center'}
            width={'100%'}
            height={'100%'}
            background={'tint2'}
            zIndex={1}
            elevation={3}
          >
            <CrossedOutIcon icon={FilmIcon} size={50} color={'muted'} />
          </Card>
          {Object.entries(sources).map(([k, source]) => (
            <VideoTag
              visible={currentSource === k}
              key={k}
              src={getActiveObjectUrl(source)}
              ref={(ref) => {
                if (ref) {
                  player.sources[k] = ref;
                }
              }}
            />
          ))}
          <FallbackVideoTag
            visible={currentSource === null}
            key={Object.entries(sources).length + 1}
          />
        </StyledPane>
        <ResizeHandle onPointerDown={onHandlePointerDown} />
      </PlayerInner>
    </PlayerContainer>
  );
}

import * as React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  SUPPORTED_IMPORT_EXTENSIONS,
  transcribeFile,
} from '../state/transcribe';
import { TitleBar } from '../components/TitleBar';
import { AppContainer, MainCenterColumn } from '../components/Util';
import styled from 'styled-components';
import { openModelManager } from '../state/nav';
import { resetTour } from '../components/Tour';
import {
  Button,
  CommentIcon,
  IconButton,
  SettingsIcon,
  Tooltip,
  Text,
  Heading,
  Link,
} from 'evergreen-ui';
import { LandingTour } from '../tour/LandingTour';
import { openDocumentFromDisk, openDocumentFromMemory } from '../state/editor/io';
import { getEmptyDocument } from '../core/document';
import { MenuBar, MenuGroup, MenuItem } from '../components/Menu';
import { RootState } from '../state';
import { shell } from 'electron';
import { useTheme } from '../components/theme';

const BottomRightContainer = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  margin: 10px;
  & > * {
    margin: 5px;
  }
`;

function getDroppedFile(event: React.DragEvent) {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as File & { path?: string };
    if (!f.path) continue;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'audapolis') return { path: f.path, kind: 'audapolis' };
    if (SUPPORTED_IMPORT_EXTENSIONS.includes(ext)) {
      return { path: f.path, kind: 'media' };
    }
  }
  return null;
}

export function LandingPage(): JSX.Element {
  const dispatch = useDispatch();
  const theme = useTheme();
  const connected = useSelector(
    (state: RootState) => state.server.servers[state.server.selectedServer]
  );
  const [dragActive, setDragActive] = React.useState(false);
  const dragCounter = React.useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    if (!connected) return;
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (!hasFiles) return;
    e.preventDefault();
    dragCounter.current++;
    if (!dragActive) setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!connected) return;
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (!hasFiles) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (!connected) return;
    const dropped = getDroppedFile(e);
    if (!dropped) {
      alert(
        'Drop an .audapolis project, or a supported audio/video file:\n' +
          SUPPORTED_IMPORT_EXTENSIONS.map((x) => '.' + x).join(', ')
      );
      return;
    }
    if (dropped.kind === 'audapolis') {
      dispatch(openDocumentFromDisk(dropped.path));
    } else {
      dispatch(transcribeFile(dropped.path));
    }
  };

  return (
    <AppContainer onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {connected ? <LandingContent /> : <ConnectingContent />}
      {dragActive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.colors.overlayBackgroundColor,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4em',
              border: `3px dashed ${theme.colors.border.default}`,
              color: theme.colors.default,
            }}
          >
            Drop an .audapolis project to open, or media to transcribe
          </div>
        </div>
      )}
    </AppContainer>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link cursor={'pointer'} onClick={() => shell.openExternal(href)}>
      {children}
    </Link>
  );
}

function ConnectingContent(): JSX.Element {
  return (
    <>
      <TitleBar />
      <MainCenterColumn>
        <Heading>Starting app...</Heading>
        <p />
        <Text>
          This should only take a few seconds. If it takes much longer,{' '}
          <ExternalLink href={'https://github.com/bugbakery/audapolis/issues/new'}>
            please report to us
          </ExternalLink>
        </Text>
      </MainCenterColumn>
    </>
  );
}

function LandingContent(): JSX.Element {
  const dispatch = useDispatch();

  return (
    <>
      <MenuBar>
        <MenuGroup label={'File'}>
          <MenuItem
            callback={() => dispatch(openDocumentFromDisk())}
            accelerator={'CommandOrControl+O'}
            label={'Open'}
          />
          <MenuItem
            callback={() => dispatch(transcribeFile())}
            accelerator={'CommandOrControl+I'}
            label={'Import & Transcribe'}
          />
          <MenuItem
            callback={() => dispatch(openDocumentFromMemory(getEmptyDocument()))}
            accelerator={'CommandOrControl+Shift+N'}
            label={'New blank document'}
          />
        </MenuGroup>
      </MenuBar>

      <LandingTour />
      <TitleBar />
      <MainCenterColumn>
        <Button
          appearance="primary"
          onClick={() => dispatch(transcribeFile())}
          id={'import' /* for tour */}
          size={'large'}
          marginY={5}
          width={300}
        >
          Import & Transcribe
        </Button>
        <Button
          appearance="primary"
          onClick={() => dispatch(openDocumentFromDisk())}
          size={'large'}
          marginY={5}
          width={300}
        >
          Open Existing
        </Button>
        <Button
          onClick={() => dispatch(openDocumentFromMemory(getEmptyDocument()))}
          size={'large'}
          marginY={20}
          width={300}
        >
          New Blank Document
        </Button>
      </MainCenterColumn>
      <BottomRightContainer>
        <Tooltip content="restart help tour">
          <IconButton icon={CommentIcon} onClick={() => resetTour()} />
        </Tooltip>
        <Tooltip content="manage transcription models">
          <IconButton icon={SettingsIcon} onClick={() => dispatch(openModelManager())} />
        </Tooltip>
      </BottomRightContainer>
    </>
  );
}

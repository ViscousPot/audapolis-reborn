import React, { useEffect, useRef, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../state';
import { setFindPopup, setFindText } from '../../state/editor/display';
import { memoizedTimedDocumentItems } from '../../state/editor/selectors';
import { useTheme } from '../../components/theme';
import styled from 'styled-components';

const FindContainer = styled.div<{ backgroundColor: string; borderColor: string }>`
  position: fixed;
  bottom: 12px;
  left: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${({ backgroundColor }) => backgroundColor};
  border: 1px solid ${({ borderColor }) => borderColor};
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;

const FindInput = styled.input<{ textColor: string; placeholderColor: string }>`
  background: transparent;
  border: none;
  outline: none;
  color: ${({ textColor }) => textColor};
  font-size: 14px;
  font-family: 'SF UI Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
    Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
  width: 180px;
  &::placeholder {
    color: ${({ placeholderColor }) => placeholderColor};
  }
`;

const MatchCount = styled.span<{ color: string }>`
  color: ${({ color }) => color};
  font-size: 12px;
  min-width: 40px;
  text-align: center;
  user-select: none;
`;

const CloseButton = styled.button<{ color: string; hoverColor: string }>`
  background: none;
  border: none;
  color: ${({ color }) => color};
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
  &:hover {
    color: ${({ hoverColor }) => hoverColor};
  }
`;

export function FindPopup(): JSX.Element {
  const dispatch = useDispatch();
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);

  const findText = useSelector((state: RootState) => state.editor.present?.findText || '');
  const findPopupVisible = !!useSelector(
    (state: RootState) => state.editor.present?.findPopupVisible
  );
  const content = useSelector((state: RootState) =>
    state.editor.present
      ? memoizedTimedDocumentItems(state.editor.present.document.content)
      : []
  );

  const matchCount = useMemo(() => {
    if (!findText) return 0;
    const lowerFind = findText.toLowerCase();
    return content.filter(
      (item) => item.type === 'text' && item.text.toLowerCase().includes(lowerFind)
    ).length;
  }, [findText, content]);

  const bgColor = theme.colors.overlayBackgroundColor;
  const borderColor = theme.colors.border?.default || '#888';
  const textColor = theme.colors.default || 'white';
  const placeholderColor = theme.colors.muted || '#ccc';

  useEffect(() => {
    if (findPopupVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [findPopupVisible]);

  if (!findPopupVisible) return <></>;

  return (
    <FindContainer backgroundColor={bgColor} borderColor={borderColor}>
      <FindInput
        ref={inputRef}
        textColor={textColor}
        placeholderColor={placeholderColor}
        placeholder="Find in page..."
        value={findText}
        onChange={(e) => dispatch(setFindText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            dispatch(setFindPopup(false));
          }
        }}
      />
      {findText && (
        <MatchCount color={placeholderColor}>
          {matchCount} {matchCount === 1 ? 'match' : 'matches'}
        </MatchCount>
      )}
      <CloseButton
        color={placeholderColor}
        hoverColor={textColor}
        onClick={() => dispatch(setFindPopup(false))}
      >
        ✕
      </CloseButton>
    </FindContainer>
  );
}

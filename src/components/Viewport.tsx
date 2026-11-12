import { useEffect, useRef, type MutableRefObject } from 'react';
import { SceneController } from '../scene/SceneController';
import type { PartId, SceneState } from '../model/catalog';

interface Props {
  state: SceneState;
  controller: MutableRefObject<SceneController | null>;
  onSelect: (part: PartId | null) => void;
  onReady: () => void;
  onError: (message: string) => void;
}
export default function Viewport({ state, controller, onSelect, onReady, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const initial = useRef({ state, onSelect, onReady, onError });
  useEffect(() => {
    if (!host.current) return;
    try {
      const props = initial.current;
      const instance = new SceneController(host.current, props.state, {
        select: props.onSelect,
        ready: props.onReady,
        error: props.onError,
      });
      controller.current = instance;
      return () => {
        instance.dispose();
        controller.current = null;
      };
    } catch {
      initial.current.onError(
        '이 브라우저에서 WebGL 2를 시작할 수 없습니다. 하드웨어 가속을 켜거나 다른 브라우저에서 열어 주세요.',
      );
    }
  }, [controller]);
  useEffect(() => {
    controller.current?.update(state);
  }, [state, controller]);
  return <div className="canvas-host" ref={host} />;
}

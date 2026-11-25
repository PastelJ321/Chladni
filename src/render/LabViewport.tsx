import { useEffect, useRef, useState } from 'react';
import { LabRenderer, type RenderData } from './LabRenderer';
import type { CameraPose } from '../animation/director';
export function LabViewport({
  data,
  api,
  onSelect,
  onPaint,
  onContextLoss,
}: {
  data: RenderData;
  api: React.MutableRefObject<LabRenderer | null>;
  onSelect: (id: string | null) => void;
  onPaint: (p: [number, number]) => void;
  onContextLoss?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef({ data, onSelect, onPaint, onContextLoss }),
    retry = useRef<() => void>(() => {});
  latest.current = { data, onSelect, onPaint, onContextLoss };
  const [error, setError] = useState(''),
    [lost, setLost] = useState(false);
  useEffect(() => {
    let renderer: LabRenderer | null = null,
      remove = () => {},
      cancelled = false,
      restoring = 0;
    function build(pose?: CameraPose) {
      remove();
      renderer?.dispose();
      api.current = null;
      try {
        const state = latest.current;
        renderer = new LabRenderer(
          host.current!,
          state.data,
          (id) => latest.current.onSelect(id),
          (p) => latest.current.onPaint(p),
        );
        if (pose) renderer.rig.restore(pose);
        api.current = renderer;
        setError('');
        setLost(false);
        const canvas = renderer.renderer.domElement;
        const loss = (event: Event) => {
          event.preventDefault();
          setLost(true);
          latest.current.onContextLoss?.();
        };
        const restore = () => {
          if (!cancelled) {
            const saved = renderer?.rig.pose();
            restoring = requestAnimationFrame(() => build(saved));
          }
        };
        canvas.addEventListener('webglcontextlost', loss);
        canvas.addEventListener('webglcontextrestored', restore);
        remove = () => {
          canvas.removeEventListener('webglcontextlost', loss);
          canvas.removeEventListener('webglcontextrestored', restore);
        };
      } catch (e) {
        setError(`3D 초기화 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    retry.current = () => build(renderer?.rig.pose());
    build();
    return () => {
      cancelled = true;
      cancelAnimationFrame(restoring);
      remove();
      renderer?.dispose();
      api.current = null;
    };
  }, [api]);
  useEffect(() => api.current?.update(data), [api, data]);
  return (
    <>
      <div
        className="lab-canvas"
        ref={host}
        data-context-state={lost ? 'lost' : error ? 'failed' : 'ready'}
      />
      {(error || lost) && (
        <div className="render-error" role="alert">
          <strong>{error || '그래픽 연결 복구 대기 중'}</strong>
          <p>실험 데이터는 유지됩니다. 복구 후 다시 재생하세요.</p>
          <button onClick={() => retry.current()}>3D 다시 초기화</button>
        </div>
      )}
    </>
  );
}

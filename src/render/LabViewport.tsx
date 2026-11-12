import { useEffect, useRef, useState } from 'react';
import { LabRenderer, type RenderData } from './LabRenderer';
export function LabViewport({
  data,
  api,
  onSelect,
  onPaint,
}: {
  data: RenderData;
  api: React.MutableRefObject<LabRenderer | null>;
  onSelect: (id: string | null) => void;
  onPaint: (p: [number, number]) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    initial = useRef({ data, onSelect, onPaint });
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      const d = initial.current,
        renderer = new LabRenderer(host.current!, d.data, d.onSelect, d.onPaint);
      api.current = renderer;
      return () => {
        renderer.dispose();
        api.current = null;
      };
    } catch (e) {
      setError(`3D 초기화 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api]);
  useEffect(() => api.current?.update(data), [api, data]);
  return (
    <>
      <div className="lab-canvas" ref={host} />
      {error && (
        <div className="render-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

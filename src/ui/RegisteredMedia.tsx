import { useEffect, useRef, useState } from 'react';
import type { Config, Field, Run } from '../experiment/types';
import type { ImagePoint } from '../analysis/observationTypes';
import { rectifyPixels, validCorners } from '../analysis/registration';
import { DEFAULT_ANALYSIS, validRegion, type Region } from '../analysis/metrics';
import { isolines } from '../render/layers';
import { frameAt } from '../simulation/particles';
import type { Observations } from './ResearchTools';
export function MediaPreview({
  m,
  field,
  config,
  run,
  time = 0,
}: {
  m: Observations;
  field?: Field | null;
  config?: Config;
  run?: Run | null;
  time?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    lastDraw = useRef(0),
    imageCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null),
    drag = useRef<ImagePoint | null>(null),
    [drawError, setDrawError] = useState('');
  const aligned = m.corrected && validCorners(m.corners);
  useEffect(() => {
    if (!m.media || !aligned) return;
    const delay = Math.max(0, 125 - (performance.now() - lastDraw.current));
    const timer = setTimeout(() => {
      const c = canvas.current,
        source = m.media!.type.startsWith('video/') ? m.video.current : m.image.current;
      if (!c || !source) return;
      const width = 'videoWidth' in source ? source.videoWidth : source.naturalWidth,
        height = 'videoHeight' in source ? source.videoHeight : source.naturalHeight;
      if (!width || !height) return;
      try {
        const aspect = config ? config.plate.width / config.plate.height : 1;
        c.width = Math.round(aspect >= 1 ? 512 : 512 * aspect);
        c.height = Math.round(aspect >= 1 ? 512 / aspect : 512);
        const key = JSON.stringify([
          m.media!.url,
          m.corners,
          'currentTime' in source ? source.currentTime : 0,
          c.width,
          c.height,
        ]);
        let corrected = imageCache.current?.key === key ? imageCache.current.canvas : null;
        if (!corrected) {
          const input = document.createElement('canvas'),
            scale = Math.min(1, 1536 / Math.max(width, height));
          input.width = Math.round(width * scale);
          input.height = Math.round(height * scale);
          const ictx = input.getContext('2d', { willReadFrequently: true })!;
          ictx.drawImage(source, 0, 0, input.width, input.height);
          const pixels = rectifyPixels(
            ictx.getImageData(0, 0, input.width, input.height).data,
            input.width,
            input.height,
            m.corners,
            c.width,
            c.height,
          );
          corrected = document.createElement('canvas');
          corrected.width = c.width;
          corrected.height = c.height;
          corrected.getContext('2d')!.putImageData(new ImageData(pixels, c.width, c.height), 0, 0);
          imageCache.current = { key, canvas: corrected };
        }
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#0c293a';
        ctx.fillRect(0, 0, c.width, c.height);
        if (m.overlay && run) {
          const positions = frameAt(run, time).positions;
          for (let i = 0; i < run.species.length; i++) {
            ctx.fillStyle = run.species[i] ? '#dbe8e8' : '#d7a363';
            ctx.fillRect(
              positions[i * 2] * c.width - 0.5,
              positions[i * 2 + 1] * c.height - 0.5,
              1.5,
              1.5,
            );
          }
        }
        ctx.globalAlpha = m.overlay ? m.opacity : 1;
        ctx.drawImage(corrected, 0, 0);
        ctx.globalAlpha = 1;
        if (m.showNodes && field && field.peak > 1e-20) {
          const lines = isolines(
            field.amplitude,
            field.size,
            field.peak * DEFAULT_ANALYSIS.nodeThreshold,
          );
          ctx.beginPath();
          for (let i = 0; i < lines.length; i += 4) {
            ctx.moveTo(lines[i] * c.width, lines[i + 1] * c.height);
            ctx.lineTo(lines[i + 2] * c.width, lines[i + 3] * c.height);
          }
          ctx.strokeStyle = '#0c2330';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.strokeStyle = '#42b6c6';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.strokeStyle = '#d7a363';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(
          m.roi[0] * c.width,
          m.roi[1] * c.height,
          (m.roi[2] - m.roi[0]) * c.width,
          (m.roi[3] - m.roi[1]) * c.height,
        );
        lastDraw.current = performance.now();
        setDrawError('');
      } catch {
        setDrawError('영상 픽셀을 읽지 못했습니다. 다른 프레임이나 이미지로 지정하세요.');
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [
    m.media,
    aligned,
    m.corners,
    m.opacity,
    m.overlay,
    m.showNodes,
    m.roi,
    m.frameTime,
    m.revision,
    field,
    config,
    run,
    time,
  ]);
  if (!m.media) return null;
  const point = (ev: React.PointerEvent<HTMLCanvasElement>): ImagePoint => {
    const b = ev.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (ev.clientX - b.x) / b.width)),
      Math.max(0, Math.min(1, (ev.clientY - b.y) / b.height)),
    ];
  };
  return (
    <div className={`media-preview ${m.overlay ? 'overlay' : ''} ${aligned ? 'registered' : ''}`}>
      <div
        className={`registration-original ${aligned ? 'source-hidden' : ''}`}
        style={{
          position: aligned ? 'absolute' : 'relative',
          width: aligned ? 1 : '100%',
          height: aligned ? 1 : undefined,
          overflow: aligned ? 'hidden' : undefined,
          aspectRatio: `${m.size[0]} / ${m.size[1]}`,
        }}
      >
        {m.media.type.startsWith('video/') ? (
          <video
            ref={m.video}
            src={m.media.url}
            controls={!aligned && !m.picking}
            playsInline
            onLoadedMetadata={m.loaded}
            onSeeked={() => {
              m.setFrameTime(m.video.current?.currentTime ?? 0);
            }}
            onTimeUpdate={() => m.setFrameTime(m.video.current?.currentTime ?? 0)}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
          />
        ) : (
          <img
            ref={m.image}
            src={m.media.url}
            alt={`실측 기록 ${m.media.name}`}
            onLoad={m.loaded}
            style={{ width: '100%', height: '100%', objectFit: 'fill' }}
          />
        )}
        {m.picking && (
          <div
            className="corner-picker"
            role="button"
            tabIndex={0}
            aria-label={`판 모서리 ${m.corners.length + 1} 지정`}
            style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}
            onClick={(ev) => {
              const b = ev.currentTarget.getBoundingClientRect();
              m.corner([(ev.clientX - b.x) / b.width, (ev.clientY - b.y) / b.height]);
            }}
          />
        )}
        {!aligned && (
          <svg
            className="corner-markers"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            {m.corners.map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y} r=".015" fill="#d7a363" stroke="#071a2b" strokeWidth=".003" />
                <text
                  x={x + 0.02}
                  y={y + 0.015}
                  fontSize=".045"
                  fill="#fff"
                  stroke="#071a2b"
                  strokeWidth=".001"
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {aligned && (
        <canvas
          ref={canvas}
          className="registered-media-canvas"
          role="img"
          aria-label="판 좌표로 원근 보정한 실측 영상"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            touchAction: 'none',
            cursor: 'crosshair',
          }}
          onPointerDown={(ev) => {
            drag.current = point(ev);
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerUp={(ev) => {
            if (!drag.current) return;
            const p = point(ev),
              a = drag.current,
              roi: Region = [
                Math.min(a[0], p[0]),
                Math.min(a[1], p[1]),
                Math.max(a[0], p[0]),
                Math.max(a[1], p[1]),
              ];
            if (validRegion(roi) && roi[2] - roi[0] > 0.005 && roi[3] - roi[1] > 0.005)
              m.setROI(roi);
            drag.current = null;
          }}
        />
      )}
      <span>
        실측 · {m.media.name} {m.frequency && ` / ${m.frequency} Hz`} ·{' '}
        {aligned ? '판 좌표 정합 · 4점 보정' : '원근 미보정'}
        {aligned &&
          m.showNodes &&
          field &&
          ` · FEM 진폭 ${Math.round(DEFAULT_ANALYSIS.nodeThreshold * 100)}% 경계`}
      </span>
      {drawError && <p role="alert">{drawError}</p>}
    </div>
  );
}

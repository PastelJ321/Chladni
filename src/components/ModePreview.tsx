import { useMemo } from 'react';
import { contours } from '../model/physics';

export default function ModePreview({ modeIndex }: { modeIndex: number }) {
  const path = useMemo(() => {
    const points = contours(modeIndex, 0, false, 44);
    let path = '';
    for (let i = 0; i < points.length; i += 4)
      path += `M${(points[i] + 1) * 22 + 5},${(points[i + 1] + 1) * 22 + 5}L${(points[i + 2] + 1) * 22 + 5},${(points[i + 3] + 1) * 22 + 5}`;
    return path;
  }, [modeIndex]);
  return (
    <svg viewBox="0 0 54 54" aria-hidden="true">
      <rect
        x="5"
        y="5"
        width="44"
        height="44"
        rx="1"
        fill="none"
        stroke="currentColor"
        opacity="0.3"
      />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="0.9" />
      <circle cx="27" cy="27" r="1.2" fill="currentColor" />
    </svg>
  );
}

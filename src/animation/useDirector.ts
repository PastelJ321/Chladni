import { useEffect, useRef, useState } from 'react';
import { AnimationDirector, type CameraPose, type SequenceId } from './director';
export function useDirector() {
  const ref = useRef(new AnimationDirector());
  const [, update] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      notify = last,
      revision = ref.current.revision;
    const tick = (now: number) => {
      if (!document.hidden) ref.current.tick((now - last) / 1000, speed);
      last = now;
      if (now - notify > 40 && revision !== ref.current.revision) {
        revision = ref.current.revision;
        update((v) => v + 1);
        notify = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [speed]);
  const act = (fn: () => void) => {
    fn();
    update((v) => v + 1);
  };
  return {
    director: ref.current,
    speed,
    setSpeed,
    start: (id: SequenceId, origin: CameraPose) => act(() => ref.current.start(id, origin)),
    pause: () => act(() => ref.current.pause()),
    resume: () => act(() => ref.current.resume()),
    stop: () => act(() => ref.current.stop()),
    seek: (t: number) => act(() => ref.current.seek(t)),
  };
}

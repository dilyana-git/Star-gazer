/**
 * Point the phone at the sky and the chart follows (spec §14.1).
 *
 * The conversion itself lives in `astro/orientation.ts` and is tested there.
 * What is here is the browser side of it: permission, the two different event
 * names, and not re-rendering React sixty times a second.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { pointingFromDeviceAngles, PointingSmoother, type Pointing } from '../astro/orientation';

export type OrientationStatus =
  /** No motion sensors, or no support for the API. */
  | 'unsupported'
  /** Supported, not yet switched on. */
  | 'idle'
  /** Waiting for the person to answer the permission prompt. */
  | 'asking'
  /** They said no. */
  | 'denied'
  /** Running, and the compass is referenced to true north. */
  | 'tracking'
  /**
   * Running, but the readings are relative to wherever the device happened to
   * start rather than to north — so the altitude is right and the bearing is
   * not. Worth saying out loud rather than quietly pointing at the wrong part
   * of the sky.
   */
  | 'no-compass';

interface DeviceOrientationEventWithCompass extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** iOS 13+ gates the sensors behind a call that must come from a user gesture. */
interface RequestableDeviceOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

export interface UseDeviceOrientation {
  status: OrientationStatus;
  /** Latest smoothed direction, or null before the first reading. */
  pointing: Pointing | null;
  /** Ask for permission if needed, then start. Must be called from a gesture. */
  start(): Promise<void>;
  stop(): void;
}

export function useDeviceOrientation(onPoint?: (p: Pointing) => void): UseDeviceOrientation {
  const [status, setStatus] = useState<OrientationStatus>(() =>
    typeof window !== 'undefined' && 'DeviceOrientationEvent' in window ? 'idle' : 'unsupported',
  );
  const [pointing, setPointing] = useState<Pointing | null>(null);

  const smoother = useRef(new PointingSmoother());
  const listening = useRef(false);
  const frame = useRef(0);
  const pending = useRef<Pointing | null>(null);
  const callback = useRef(onPoint);
  callback.current = onPoint;

  const handle = useCallback((event: Event) => {
    const e = event as DeviceOrientationEventWithCompass;
    const raw = pointingFromDeviceAngles({
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      compassHeading: e.webkitCompassHeading ?? null,
    });
    if (!raw) return;

    // `absolute` (or an iOS compass heading) means the bearing is referenced to
    // true north. Without it the altitude is still right, so tracking is worth
    // keeping — but the user needs telling that the compass is not.
    const referenced = e.absolute === true || e.webkitCompassHeading != null;
    setStatus(referenced ? 'tracking' : 'no-compass');

    // The sensor fires faster than the screen repaints. Coalescing to one
    // animation frame keeps React out of the way of the canvas.
    pending.current = smoother.current.push(raw);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = pending.current;
      if (!next) return;
      setPointing(next);
      callback.current?.(next);
    });
  }, []);

  const attach = useCallback(() => {
    if (listening.current) return;
    listening.current = true;
    smoother.current.reset();
    // Chrome on Android needs the `absolute` variant for a true-north bearing;
    // Safari has no such event and puts the bearing on the ordinary one.
    window.addEventListener('deviceorientationabsolute', handle, true);
    window.addEventListener('deviceorientation', handle, true);
  }, [handle]);

  const detach = useCallback(() => {
    listening.current = false;
    window.removeEventListener('deviceorientationabsolute', handle, true);
    window.removeEventListener('deviceorientation', handle, true);
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = null;
    smoother.current.reset();
  }, [handle]);

  const start = useCallback(async () => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      setStatus('unsupported');
      return;
    }

    const requestable = DeviceOrientationEvent as unknown as RequestableDeviceOrientationEvent;
    if (typeof requestable.requestPermission === 'function') {
      setStatus('asking');
      try {
        const answer = await requestable.requestPermission();
        if (answer !== 'granted') {
          setStatus('denied');
          return;
        }
      } catch {
        // Thrown when the call did not come from a user gesture. Treated as a
        // refusal, because from here it is indistinguishable from one.
        setStatus('denied');
        return;
      }
    }

    setStatus('tracking');
    attach();

    // Some devices fire nothing at all — no gyroscope, or a browser that
    // reports support and then stays silent. Say so rather than leaving a
    // button lit up over a chart that never moves.
    window.setTimeout(() => {
      if (listening.current && pending.current == null) setStatus('unsupported');
    }, 2500);
  }, [attach]);

  const stop = useCallback(() => {
    detach();
    setPointing(null);
    setStatus((s) => (s === 'tracking' || s === 'no-compass' ? 'idle' : s));
  }, [detach]);

  useEffect(() => detach, [detach]);

  return { status, pointing, start, stop };
}

/** True when the viewport is phone-sized. */
export function useIsPhone(): boolean {
  return useMediaQuery('(max-width: 760px)');
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

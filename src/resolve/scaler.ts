import type { ScalerConfig, UserConfig } from '../types.js';

export const DEFAULT_SCALER: ScalerConfig = { referenceWidth: 402, referenceHeight: 874 };

type Opts = { min?: number; max?: number; useUniform?: boolean };

function clamp(v: number, o: Opts): number {
  let r = v;
  if (o.min !== undefined) r = Math.max(r, o.min);
  if (o.max !== undefined) r = Math.min(r, o.max);
  return r;
}

/**
 * Formulas copied from @shayrn/react-native-scaler v1.2.0 (src/responsive.ts).
 * Assumes PixelRatio.roundToNearestPixel is 1:1 and font scale is 1.0.
 */
export function scalerFns(vw: { width: number; height: number }, cfg: ScalerConfig) {
  const widthScale = vw.width / cfg.referenceWidth;
  const heightScale = vw.height / cfg.referenceHeight;
  const uniform = Math.min(widthScale, heightScale);
  const round = Math.round;
  return {
    scale: (size: number, o: Opts = {}) => round(clamp(size * (o.useUniform === false ? widthScale : uniform), o)),
    scaleFont: (size: number, o: Opts = {}) => round(clamp(size * uniform, { min: o.min ?? 10, max: o.max ?? 100 })),
    scaleLineHeight: (size: number, o: Opts = {}) => round(clamp(size * uniform, o)),
    scaleRadius: (size: number, o: Opts = {}) => round(clamp(size * uniform, o)),
    scaleWidth: (size: number, o: Opts = {}) => round(clamp(size * widthScale, o)),
    scaleHeight: (size: number, o: Opts = {}) => round(clamp(size * heightScale, o)),
  } as Record<string, (size: number, o?: Opts) => number>;
}

/** Formula table for other helper libraries. Values are not rounded (those libraries do not round). */
export function tableScalers(vw: { width: number; height: number }, config?: UserConfig) {
  const short = Math.min(vw.width, vw.height);
  const long = Math.max(vw.width, vw.height);
  const out: Record<string, Record<string, (size: number, f?: number) => number>> = {
    'react-native-size-matters': {
      scale: (s) => (short / 350) * s,
      verticalScale: (s) => (long / 680) * s,
      moderateScale: (s, f = 0.5) => s + ((short / 350) * s - s) * f,
      moderateVerticalScale: (s, f = 0.5) => s + ((long / 680) * s - s) * f,
      s: (s) => (short / 350) * s,
      vs: (s) => (long / 680) * s,
      ms: (s, f = 0.5) => s + ((short / 350) * s - s) * f,
    },
  };
  for (const [mod, fns] of Object.entries(config?.scalers ?? {})) {
    out[mod] = out[mod] ?? {};
    for (const [name, spec] of Object.entries(fns)) {
      const [rw, rh] = spec.reference ?? [402, 874];
      out[mod][name] = (s, f) => {
        const ws = vw.width / rw;
        const hs = vw.height / rh;
        if (spec.axis === 'width') return s * ws;
        if (spec.axis === 'height') return s * hs;
        if (spec.axis === 'moderate') return s + (s * ws - s) * (f ?? spec.factor ?? 0.5);
        return s * Math.min(ws, hs);
      };
    }
  }
  return out;
}

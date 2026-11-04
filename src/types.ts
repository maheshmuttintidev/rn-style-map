export type Platform = 'android' | 'ios';
export type Scheme = 'light' | 'dark';
export type Format = 'compact' | 'json' | 'md';

export type Reason =
  | 'RUNTIME_VALUE'
  | 'SPREAD'
  | 'UNKNOWN_IMPORT'
  | 'DYNAMIC_CLASS'
  | 'UNKNOWN_CLASS'
  | 'HOOK_UNSUPPORTED'
  | 'CONDITIONAL_UNKNOWN'
  | 'EXTERNAL_COMPONENT';

export type StyleSource = 'stylesheet' | 'inline' | 'theme' | 'nativewind' | 'prop';

export interface Loc {
  file: string;
  line: number;
  col?: number;
}

export interface StyleEntry {
  value: unknown;
  source: StyleSource;
  approx?: boolean;
  /** Raw source expression, kept for approximate (scaler) values. */
  expr?: string;
  /** Alternatives when a condition could not be decided statically. */
  alt?: unknown[];
}

export interface UnresolvedEntry {
  file: string;
  line: number;
  prop: string;
  expr: string;
  reason: Reason;
}

export interface MapNode {
  name: string;
  text?: string;
  loc: Loc;
  callsite?: Loc;
  style?: Record<string, StyleEntry>;
  a11y?: { role?: string; label?: string; interactive?: boolean; hitSlop?: number; allowFontScaling?: boolean; maxFontSizeMultiplier?: number };
  /** Rendered from `.map()`/list data: number of items (0 = unknown count). */
  repeat?: number;
  /** Children hidden by --depth. */
  more?: number;
  children?: MapNode[];
  /** internal: unresolved entries attached to this node */
  unresolved?: UnresolvedEntry[];
}

export interface RouteMap {
  path: string;
  file: string;
  layouts: string[];
  tree: MapNode;
  stats: { resolved: number; total: number; tokens: number };
  unresolved: UnresolvedEntry[];
  /** Present with --diff: node-level change vs a git ref. `removed` lists node lines no longer present. */
  diff?: { ref: string; status: 'added' | 'changed' | 'removed'; removed: string[] };
}

export interface Finding {
  ruleId: string;
  severity: 'error' | 'warn' | 'info' | 'unknown';
  message: string;
  file?: string;
  line?: number;
  node?: string;
  route?: string;
  url: string;
}

export interface TokenTable {
  colors: Record<string, number>;
  fonts: Record<string, number>;
  fontSizes: Record<string, number>;
  spacing: Record<string, number>;
  radii: Record<string, number>;
}

export interface ProjectInfo {
  router: 'expo-router' | 'react-navigation' | 'entry';
  platform: Platform;
  scheme: Scheme;
  viewport: { width: number; height: number };
  styling: StyleSource[];
}

export interface MapResult {
  version: 1;
  project: ProjectInfo;
  routes: RouteMap[];
  tokens?: TokenTable;
  findings?: Finding[];
}

export interface ScalerConfig {
  referenceWidth: number;
  referenceHeight: number;
}

export interface UserConfig {
  /** Formula table for other scaler helpers: module -> fn name -> { axis, factor? } */
  scalers?: Record<string, Record<string, { axis: 'width' | 'height' | 'uniform' | 'moderate'; reference?: [number, number]; factor?: number }>>;
  scaler?: Partial<ScalerConfig>;
  theme?: { hook?: string; module?: string };
  rem?: number;
  css?: string[];
  ignore?: string[];
  audit?: {
    severity?: Record<string, Finding['severity'] | 'off'>;
    maxFontFamilies?: number;
    maxFontSizes?: number;
    maxColors?: number;
    spacingGrid?: number;
    minFontSize?: number;
    nearDuplicateDeltaE?: number;
  };
}

export interface Options {
  root: string;
  route?: string[];
  entry?: string;
  depth: number;
  only?: string[];
  platform: Platform;
  scheme: Scheme;
  viewport: { width: number; height: number };
  config?: UserConfig;
}

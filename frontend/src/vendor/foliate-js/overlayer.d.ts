export function getRangeRects(range: Range): DOMRect[];

export class Overlayer {
  static outline(rects: unknown, opts?: { color?: string; width?: number; radius?: number }): SVGElement;
  static highlight(rects: unknown, opts: unknown): SVGElement;
  static underline(rects: unknown, opts: unknown): SVGElement;
  static squiggly(rects: unknown, opts: unknown): SVGElement;

  constructor(...args: unknown[]);
  add(key: string, range: unknown, draw: unknown, options: unknown): void;
  remove(key: string): void;
  hitTest(point: { x: number; y: number }): [string, Range] | [];
  hitTestAll(point: { x: number; y: number }): Array<[string, Range]>;
  [key: string]: unknown;
}

interface ScrollLayout {
  flow: string;
  width: number;
  height: number;
  margin: number;
  gap?: number;
  columnWidth?: number;
}
interface ScrollLocation {
  index: number;
  range: Range;
  fraction: number;
  reason: string;
}
export class ContinuousScroll {
  constructor(options: {
    host: HTMLElement;
    container: HTMLElement;
    sections: Array<{ load(): Promise<string> | string; unload?(): void; linear?: string }>;
    layout(direction: { vertical: boolean; rtl: boolean; background?: string }): ScrollLayout;
    styles(doc: Document): void;
    relocate(location: ScrollLocation): void;
  });
  readonly index: number;
  goTo(target: { index: number; anchor?: number | Range | ((doc: Document) => number | Range); select?: boolean }): Promise<void>;
  getContents(): Array<{ index: number; doc: Document; overlayer: unknown }>;
  fill(): Promise<void>;
  render(): void;
  scrollToAnchor(anchor: number | Range, select?: boolean): void;
  step(direction: number, distance?: number): Promise<void>;
  destroy(): void;
}

declare module '*/foliate-js/view.js' {
  export function makeBook(file: File | Blob | string): Promise<any>;
  export class View extends HTMLElement {
    book: any;
    renderer: any;
    lastLocation: any;
    isFixedLayout: boolean;
    history: any;
    open(book: any): Promise<void>;
    close(): void;
    goTo(target: any): Promise<any>;
    goToFraction(fraction: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    prev(): Promise<void>;
    next(): Promise<void>;
  }
}

declare module '*/foliate-js/ui/tree.js' {
  export function createTOCView(
    toc: any[],
    onclick: (href: string) => void
  ): { element: HTMLElement; setCurrentHref: (href: string) => void };
}

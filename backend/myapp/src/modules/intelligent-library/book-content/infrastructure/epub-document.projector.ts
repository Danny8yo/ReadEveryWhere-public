import { createHash } from "node:crypto";
import type { BookDocument, ContentRevision, DocumentSection, DocumentTocNode } from "../domain/book-document.types";

export interface ParsedEpub {
  sections: Array<DocumentSection & { headings: SourceHeading[]; fragmentHeadingIndexes: Record<string, number>; title: string }>;
  toc: RawTocNode[];
  tocSource: "ncx" | "epub_nav" | null;
}
interface RawTocNode {
  label: string;
  href: string | null;
  children: RawTocNode[];
}

interface LocatedTocNode {
  label: string;
  href: string;
  fragment: string | null;
  sectionIndex: number;
  start: number;
  endSectionIndex?: number;
  end?: number;
  anchorResolved: boolean;
  sourceHeadingLevel: SourceHeadingLevel | null;
  children: LocatedTocNode[];
}

type SourceHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface SourceHeading {
  level: SourceHeadingLevel;
  label: string;
  start: number;
}

interface ExtractedSection {
  section: DocumentSection;
  headings: SourceHeading[];
  fragmentHeadingIndexes: Record<string, number>;
}

export class EpubDocumentProjector {
  project(bookId: number, revision: ContentRevision, parsed: ParsedEpub): BookDocument {
    const sections = parsed.sections.map(({ sectionIndex, href, text, charCount, anchors }) => ({ sectionIndex, href, text, charCount, anchors }));
    const hrefToSection = new Map(parsed.sections.map(section => [section.href, { section, headings: section.headings, fragmentHeadingIndexes: section.fragmentHeadingIndexes }]));
    const rawToc = parsed.toc;
      const located = this.locateToc(rawToc, hrefToSection);
      const repaired = this.repairFlatDeclaredToc(rawToc, located, sections, hrefToSection);
      const declaredReliable = located.length > 0
        && this.siblingsHaveDistinctOrderedPositions(located)
        && this.allAnchorsResolved(located);
      const positionResolvedToc = repaired
        ?? (declaredReliable
          ? located
          : this.createSpineFallback(parsed.sections));
      const hierarchy = declaredReliable || repaired
        ? this.inferFlatHeadingHierarchy(rawToc, positionResolvedToc)
        : { roots: positionResolvedToc, headingMappedNodeCount: 0, inferredParentCount: 0 };
      const usingFallback = !repaired && !declaredReliable;
      const hierarchyStrategy = usingFallback
        ? "spine_fallback" as const
        : rawToc.some((node) => node.children.length > 0)
          ? "declared" as const
          : hierarchy.inferredParentCount > 0
            ? "inferred_headings" as const
            : "flat" as const;
      const tocQuality = usingFallback
        ? "spine_fallback" as const
        : repaired || hierarchy.inferredParentCount > 0
          ? "declared_repaired" as const
          : "declared" as const;
      const effectiveToc = hierarchy.roots;
      const toc = this.flattenToc(effectiveToc, sections, tocQuality);

      return {
        bookId,
        revision,
        tocQuality,
        tocProvenance: {
          source: usingFallback ? "spine_fallback" : parsed.tocSource!,
          positionStrategy: usingFallback ? "spine_fallback" : repaired ? "repaired" : "declared",
          hierarchyStrategy,
          headingMappedNodeCount: usingFallback ? 0 : hierarchy.headingMappedNodeCount,
          inferredParentCount: usingFallback ? 0 : hierarchy.inferredParentCount,
        },
        sections,
        toc,
      };
  }
  private locateToc(
    nodes: RawTocNode[],
    hrefToSection: Map<string, ExtractedSection>,
  ): LocatedTocNode[] {
    const locateNode = (node: RawTocNode): LocatedTocNode | null => {
      const children = node.children.map(locateNode).filter((item): item is LocatedTocNode => Boolean(item));
      const reference = node.href ? this.splitReference(node.href) : null;
      const extracted = reference ? hrefToSection.get(reference.href) : undefined;
      if (!extracted) {
        if (!children.length) return null;
        const first = children[0];
        return { ...first, label: node.label, children };
      }
      const section = extracted.section;
      const anchorResolved = !reference?.fragment || section.anchors[reference.fragment] !== undefined;
      return {
        label: node.label,
        href: section.href,
        fragment: reference?.fragment ?? null,
        sectionIndex: section.sectionIndex,
        start: reference?.fragment ? section.anchors[reference.fragment] ?? 0 : 0,
        anchorResolved,
        sourceHeadingLevel: this.resolveSourceHeadingLevel(node.label, reference?.fragment ?? null, extracted),
        children,
      };
    };

    return nodes.map(locateNode).filter((item): item is LocatedTocNode => Boolean(item));
  }

  private createSpineFallback(sections: ParsedEpub["sections"]): LocatedTocNode[] {
    return sections.map(section => ({ label: section.title, href: section.href, fragment: null, sectionIndex: section.sectionIndex, start: 0, anchorResolved: true, sourceHeadingLevel: null, children: [] }));
  }
  private flattenToc(
    roots: LocatedTocNode[],
    sections: DocumentSection[],
    quality: BookDocument["tocQuality"],
  ): DocumentTocNode[] {
    const flattened: DocumentTocNode[] = [];
    const visit = (node: LocatedTocNode, parentNodeId: string | null, level: number, parentPath: string) => {
      const path = parentPath ? `${parentPath} > ${node.label}` : node.label;
      const nodeId = quality === "spine_fallback"
        ? `spine-${node.sectionIndex}`
        : `toc-${createHash("sha256").update(`${flattened.length}|${path}|${node.href}|${node.fragment ?? ""}`).digest("hex").slice(0, 16)}`;
      const entry: DocumentTocNode = {
        nodeId,
        parentNodeId,
        linearIndex: flattened.length,
        level,
        label: node.label,
        path,
        href: node.href,
        fragment: node.fragment,
        sectionIndex: node.sectionIndex,
        start: node.start,
        endSectionIndex: node.endSectionIndex,
        end: node.end,
        ownCharCount: 0,
        subtreeCharCount: 0,
        hasChildren: node.children.length > 0,
        sourceHeadingLevel: node.sourceHeadingLevel,
      };
      flattened.push(entry);
      node.children.forEach((child) => visit(child, nodeId, level + 1, path));
    };
    roots.forEach((root) => visit(root, null, 1, ""));

    for (let index = flattened.length - 1; index >= 0; index -= 1) {
      const node = flattened[index];
      const boundary = flattened.slice(index + 1).find((candidate) => candidate.level <= node.level);
      const lastSection = sections[sections.length - 1];
      node.endSectionIndex = boundary?.sectionIndex
        ?? node.endSectionIndex
        ?? lastSection.sectionIndex;
      node.end = boundary?.start
        ?? node.end
        ?? lastSection.text.length;
      node.subtreeCharCount = this.distance(
        sections,
        node.sectionIndex,
        node.start,
        node.endSectionIndex!,
        node.end!,
      );
      const childSize = flattened
        .filter((candidate) => candidate.parentNodeId === node.nodeId)
        .reduce((total, child) => total + child.subtreeCharCount, 0);
      node.ownCharCount = Math.max(0, node.subtreeCharCount - childSize);
    }
    return flattened;
  }

  private repairFlatDeclaredToc(
    rawToc: RawTocNode[],
    located: LocatedTocNode[],
    sections: DocumentSection[],
    hrefToSection: Map<string, ExtractedSection>,
  ): LocatedTocNode[] | null {
    if (
      rawToc.length < 2
      || rawToc.length !== located.length
      || rawToc.some((node) => node.children.length > 0 || !node.href)
      || located.some((node) => node.children.length > 0)
    ) return null;

    const firstSectionIndex = located[0]?.sectionIndex;
    if (firstSectionIndex === undefined) return null;
    const remaining = sections.filter((section) => section.sectionIndex >= firstSectionIndex && section.text.length > 0);
    if (!remaining.length) return null;
    const lengths = remaining.map((section) => section.text.length).sort((left, right) => left - right);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
    const minimumChapterSize = Math.max(500, Math.floor(median * 0.2));
    const candidates = remaining.filter((section) => section.text.length >= minimumChapterSize);
    if (candidates.length !== rawToc.length || candidates[0]?.sectionIndex !== firstSectionIndex) return null;

    const alreadyMatches = located.every((node, index) => (
      node.sectionIndex === candidates[index].sectionIndex
      && node.start === 0
      && node.anchorResolved
    ));
    if (alreadyMatches) return null;

    return rawToc.map((node, index) => {
      const section = candidates[index];
      const nextCandidate = candidates[index + 1];
      const firstTrailingSection = index === candidates.length - 1
        ? sections.find((candidate) => candidate.sectionIndex > section.sectionIndex)
        : undefined;
      return {
        label: node.label,
        href: section.href,
        fragment: null,
        sectionIndex: section.sectionIndex,
        start: 0,
        endSectionIndex: nextCandidate?.sectionIndex
          ?? firstTrailingSection?.sectionIndex
          ?? section.sectionIndex,
        end: nextCandidate || firstTrailingSection ? 0 : section.text.length,
        anchorResolved: true,
        sourceHeadingLevel: this.resolveSourceHeadingLevel(
          node.label,
          null,
          hrefToSection.get(section.href),
        ),
        children: [],
      };
    });
  }

  private inferFlatHeadingHierarchy(
    rawToc: RawTocNode[],
    nodes: LocatedTocNode[],
  ): { roots: LocatedTocNode[]; headingMappedNodeCount: number; inferredParentCount: number } {
    const headingMappedNodeCount = this.countHeadingMappedNodes(nodes);
    if (
      rawToc.length !== nodes.length
      || rawToc.some((node) => node.children.length > 0)
      || nodes.some((node) => node.children.length > 0)
    ) {
      return { roots: nodes, headingMappedNodeCount, inferredParentCount: 0 };
    }

    const roots: LocatedTocNode[] = [];
    const stack: Array<{ level: SourceHeadingLevel; node: LocatedTocNode }> = [];
    let inferredParentCount = 0;
    for (const original of nodes) {
      const node = { ...original, children: [] };
      const level = node.sourceHeadingLevel;
      if (level === null) {
        roots.push(node);
        stack.length = 0;
        continue;
      }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1]?.node;
      if (parent) {
        parent.children.push(node);
        inferredParentCount += 1;
      } else {
        roots.push(node);
      }
      stack.push({ level, node });
    }
    return { roots, headingMappedNodeCount, inferredParentCount };
  }

  private countHeadingMappedNodes(nodes: LocatedTocNode[]): number {
    return nodes.reduce((total, node) => (
      total
      + (node.sourceHeadingLevel === null ? 0 : 1)
      + this.countHeadingMappedNodes(node.children)
    ), 0);
  }

  private resolveSourceHeadingLevel(
    label: string,
    fragment: string | null,
    extracted: ExtractedSection | undefined,
  ): SourceHeadingLevel | null {
    if (!extracted) return null;
    if (fragment) {
      const index = extracted.fragmentHeadingIndexes[fragment];
      return index === undefined ? null : extracted.headings[index]?.level ?? null;
    }
    const normalized = this.normalizeHeadingLabel(label);
    const matches = extracted.headings.filter((heading) => this.normalizeHeadingLabel(heading.label) === normalized);
    return matches.length === 1 ? matches[0].level : null;
  }

  private normalizeHeadingLabel(value: string): string {
    return value.normalize("NFC").replace(/\s+/gu, "").trim();
  }

  private siblingsHaveDistinctOrderedPositions(nodes: LocatedTocNode[]): boolean {
    let previous: LocatedTocNode | null = null;
    for (const node of nodes) {
      if (previous && this.comparePosition(previous, node) >= 0) return false;
      if (!this.siblingsHaveDistinctOrderedPositions(node.children)) return false;
      previous = node;
    }
    return true;
  }

  private allAnchorsResolved(nodes: LocatedTocNode[]): boolean {
    return nodes.every((node) => node.anchorResolved && this.allAnchorsResolved(node.children));
  }

  private comparePosition(left: LocatedTocNode, right: LocatedTocNode): number {
    return left.sectionIndex - right.sectionIndex || left.start - right.start;
  }

  private distance(
    sections: DocumentSection[],
    startSection: number,
    start: number,
    endSection: number | null,
    end: number | null,
  ): number {
    if (endSection !== null && endSection < startSection) return 0;
    if (endSection === startSection) return Math.max(0, (end ?? 0) - start);
    let total = 0;
    for (const section of sections) {
      if (section.sectionIndex < startSection) continue;
      if (section.sectionIndex === startSection) total += Math.max(0, section.text.length - start);
      else if (endSection === null || section.sectionIndex < endSection) total += section.text.length;
      else if (section.sectionIndex === endSection) {
        total += Math.max(0, end ?? 0);
        break;
      }
    }
    return total;
  }

  private splitReference(reference: string): { href: string; fragment: string | null } {
    const hashIndex = reference.indexOf("#");
    if (hashIndex < 0) return { href: reference, fragment: null };
    return {
      href: reference.slice(0, hashIndex),
      fragment: reference.slice(hashIndex + 1) || null,
    };
  }

}

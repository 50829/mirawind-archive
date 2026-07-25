export interface ReaderTocLink {
  readonly blockId: string;
  readonly href: string;
  readonly level: number;
  readonly pageId: number;
  readonly title: string;
}

export interface ReaderTocNode extends ReaderTocLink {
  readonly children: readonly ReaderTocNode[];
}

interface MutableReaderTocNode extends ReaderTocLink {
  children: MutableReaderTocNode[];
}

function freezeNode(node: MutableReaderTocNode): ReaderTocNode {
  return Object.freeze({
    ...node,
    children: Object.freeze(node.children.map(freezeNode)),
  });
}

export function buildReaderNavigationTree(
  links: readonly ReaderTocLink[],
): readonly ReaderTocNode[] {
  const roots: MutableReaderTocNode[] = [];
  const ancestors: MutableReaderTocNode[] = [];
  for (const link of links) {
    const node: MutableReaderTocNode = { ...link, children: [] };
    while (
      ancestors.length > 0 &&
      (ancestors.at(-1)?.level ?? 0) >= node.level
    ) {
      ancestors.pop();
    }
    const parent = ancestors.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    ancestors.push(node);
  }
  return Object.freeze(roots.map(freezeNode));
}

export function readerBreadcrumbs(
  links: readonly ReaderTocLink[],
  currentHeadingId: string | null,
): readonly ReaderTocLink[] {
  if (!currentHeadingId) return Object.freeze([]);
  const ancestors: ReaderTocLink[] = [];
  for (const link of links) {
    while (
      ancestors.length > 0 &&
      (ancestors.at(-1)?.level ?? 0) >= link.level
    ) {
      ancestors.pop();
    }
    ancestors.push(link);
    if (link.blockId === currentHeadingId) {
      return Object.freeze([...ancestors]);
    }
  }
  return Object.freeze([]);
}

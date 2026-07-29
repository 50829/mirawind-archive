import {
  buildReaderNavigationTree,
  type ReaderTocLink,
  type ReaderTocNode,
} from "@/modules/reader/application/public";

function containsHeading(node: ReaderTocNode, blockId: string | null): boolean {
  return (
    node.blockId === blockId ||
    node.children.some((child) => containsHeading(child, blockId))
  );
}

function TocNode(props: {
  readonly currentHeadingId: string | null;
  readonly currentPageId: number;
  readonly node: ReaderTocNode;
}) {
  const link = (
    <a
      aria-current={
        props.node.blockId === props.currentHeadingId ? "page" : undefined
      }
      className="reader-toc-link"
      data-current-page={
        props.node.pageId === props.currentPageId ? "" : undefined
      }
      href={props.node.href}
    >
      {props.node.title}
    </a>
  );
  if (props.node.children.length === 0) {
    return (
      <li className={`reader-toc-item reader-toc-level-${props.node.level}`}>
        {link}
      </li>
    );
  }
  return (
    <li className={`reader-toc-item reader-toc-level-${props.node.level}`}>
      <details open={containsHeading(props.node, props.currentHeadingId)}>
        <summary aria-label={`展开或折叠：${props.node.title}`}>
          <span aria-hidden="true">›</span>
        </summary>
        {link}
        <ol>
          {props.node.children.map((child) => (
            <TocNode
              currentHeadingId={props.currentHeadingId}
              currentPageId={props.currentPageId}
              key={child.blockId}
              node={child}
            />
          ))}
        </ol>
      </details>
    </li>
  );
}

export function TableOfContents(props: {
  readonly currentHeadingId: string | null;
  readonly currentPageId: number;
  readonly showHeading?: boolean;
  readonly toc: readonly ReaderTocLink[];
}) {
  const tree = buildReaderNavigationTree(props.toc);
  return (
    <nav aria-label="全书目录" className="reader-toc">
      {props.showHeading !== false && <h2>全书目录</h2>}
      <ol className="reader-toc-tree">
        {tree.map((node) => (
          <TocNode
            currentHeadingId={props.currentHeadingId}
            currentPageId={props.currentPageId}
            key={node.blockId}
            node={node}
          />
        ))}
      </ol>
    </nav>
  );
}

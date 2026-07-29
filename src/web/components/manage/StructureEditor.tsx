import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  FilePenLine,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  manageDialog,
  manageDialogClose,
  manageDialogHeader,
  manageField,
  manageFieldLabel,
  manageQuietButton,
  manageSecondaryButton,
} from "@/web/components/ui/manage-classes";

import {
  changeDisplayLevel,
  mergeAcceptedNodes,
  type ContentRole,
  type EditableStructureNode as StructureNode,
} from "@/web/components/manage/structure-editor-state";

interface HeadingContext {
  readonly block_id: string;
  readonly source_level: number;
  readonly source_title?: string;
  readonly title: string;
}

interface TypographySummary {
  readonly profile: "verbatim-v1" | "zh-smart-v1";
  readonly protected_nodes: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
}

const roleLabels: Readonly<Record<ContentRole, string>> = {
  appendix: "附录",
  backmatter: "后置内容",
  body: "正文",
  frontmatter: "前置内容",
};

function withoutOptional(
  node: StructureNode,
  key: "display_title" | "role",
): StructureNode {
  return Object.fromEntries(
    Object.entries(node).filter(([name]) => name !== key),
  ) as unknown as StructureNode;
}

function withoutCollapsedDescendants(
  nodes: readonly StructureNode[],
  collapsedIds: ReadonlySet<string>,
): readonly StructureNode[] {
  const visible: StructureNode[] = [];
  let hiddenBelowLevel: number | null = null;
  for (const node of nodes) {
    if (hiddenBelowLevel !== null && node.display_level > hiddenBelowLevel) {
      continue;
    }
    hiddenBelowLevel = null;
    visible.push(node);
    if (collapsedIds.has(node.block_id)) {
      hiddenBelowLevel = node.display_level;
    }
  }
  return visible;
}

export interface StructureEditorHandle {
  readonly save: () => void;
}

export interface StructureEditorState {
  readonly conflict: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
}

export const StructureEditor = forwardRef<
  StructureEditorHandle,
  {
    readonly bookId: number;
    readonly etag: string;
    readonly focusedBlockId?: string | null;
    readonly headings: readonly HeadingContext[];
    readonly onSaved: () => Promise<void>;
    readonly onStateChange: (state: StructureEditorState) => void;
    readonly revision: number;
    readonly saveDisabled?: boolean;
    readonly structure: readonly StructureNode[];
    readonly typography?: TypographySummary | undefined;
  }
>(function StructureEditor(props, ref) {
  const initialNodes = props.structure;
  const [nodes, setNodes] = useState(initialNodes);
  const [query, setQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedId, setSelectedId] = useState(
    initialNodes.at(0)?.block_id ?? "",
  );
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const onStateChange = props.onStateChange;
  const nodesRef = useRef(nodes);
  const acceptedSnapshot = useRef<{
    readonly nodes: readonly StructureNode[];
  } | null>(null);
  const selectedDialog = useRef<HTMLDialogElement>(null);
  const selectedDialogTrigger = useRef<HTMLButtonElement>(null);
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const sourceDialogTrigger = useRef<HTMLButtonElement>(null);
  const lastRevision = useRef(props.revision);
  nodesRef.current = nodes;
  const headingById = useMemo(
    () => new Map(props.headings.map((heading) => [heading.block_id, heading])),
    [props.headings],
  );
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return nodes;
    return nodes.filter((node) => {
      const heading = headingById.get(node.block_id);
      return [
        node.display_title,
        heading?.source_title,
        heading?.title,
        node.block_id,
      ].some((value) => value?.toLocaleLowerCase("zh-CN").includes(normalized));
    });
  }, [headingById, nodes, query]);
  const expandableIds = useMemo(
    () =>
      new Set(
        nodes.flatMap((node, index) =>
          (nodes[index + 1]?.display_level ?? 0) > node.display_level
            ? [node.block_id]
            : [],
        ),
      ),
    [nodes],
  );
  const visibleNodes = useMemo(
    () =>
      query.trim()
        ? filteredNodes
        : withoutCollapsedDescendants(nodes, collapsedIds),
    [collapsedIds, filteredNodes, nodes, query],
  );
  const listParent = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleNodes.length,
    estimateSize: () => 44,
    getScrollElement: () => listParent.current,
    overscan: 8,
  });
  const selectedIndex = nodes.findIndex((node) => node.block_id === selectedId);
  const selected = selectedIndex >= 0 ? nodes[selectedIndex] : undefined;
  const selectedHeading = selected
    ? headingById.get(selected.block_id)
    : undefined;

  useEffect(() => {
    if (props.revision === lastRevision.current) return;
    const accepted = acceptedSnapshot.current;
    if (accepted) {
      setNodes((current) =>
        mergeAcceptedNodes(props.structure, accepted.nodes, current),
      );
    } else {
      setNodes(props.structure);
    }
    acceptedSnapshot.current = null;
    lastRevision.current = props.revision;
  }, [props.revision, props.structure]);

  useEffect(() => {
    if (
      props.focusedBlockId &&
      nodes.some((node) => node.block_id === props.focusedBlockId)
    ) {
      setSelectedId(props.focusedBlockId);
    }
  }, [nodes, props.focusedBlockId]);

  function updateSelected(change: Partial<StructureNode>) {
    if (selectedIndex < 0) return;
    setNodes((current) =>
      current.map((node, index) =>
        index === selectedIndex ? { ...node, ...change } : node,
      ),
    );
  }

  function updateDisplayTitle(value: string) {
    if (!selected) return;
    const base = withoutOptional(selected, "display_title");
    updateSelected(value ? { ...base, display_title: value } : base);
  }

  function renderSelectedNode(titleId: string) {
    return (
      <>
        <h2 className="text-base font-bold" id={titleId}>
          当前结构项
        </h2>
        {!selected ? (
          <p>没有匹配的结构项。</p>
        ) : (
          <>
            <p className="source-heading mt-3 font-semibold">
              {selectedHeading?.source_title ??
                selectedHeading?.title ??
                selected.block_id}
              {selectedHeading ? ` · 源 H${selectedHeading.source_level}` : ""}
            </p>
            <label className={manageFieldLabel}>
              显示标题
              <input
                className={manageField}
                maxLength={500}
                onChange={(event) =>
                  updateDisplayTitle(event.currentTarget.value)
                }
                placeholder={
                  selectedHeading?.source_title ?? selectedHeading?.title ?? ""
                }
                value={selected.display_title ?? ""}
              />
            </label>
            <div className="structure-fields grid grid-cols-2 gap-3">
              <label className={manageFieldLabel}>
                显示层级
                <select
                  className={manageField}
                  onChange={(event) => {
                    const displayLevel = Number(event.currentTarget.value);
                    setNodes((current) =>
                      current.map((node, index) =>
                        index === selectedIndex
                          ? changeDisplayLevel(node, displayLevel)
                          : node,
                      ),
                    );
                  }}
                  value={selected.display_level}
                >
                  {[1, 2, 3, 4].map((level) => (
                    <option key={level} value={level}>
                      H{level}
                    </option>
                  ))}
                </select>
              </label>
              {selected.display_level === 1 && (
                <label className={manageFieldLabel}>
                  内容角色
                  <select
                    className={manageField}
                    onChange={(event) =>
                      updateSelected({
                        role: event.currentTarget.value as ContentRole,
                      })
                    }
                    value={selected.role ?? "body"}
                  >
                    {Object.entries(roleLabels).map(([role, label]) => (
                      <option key={role} value={role}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="structure-checks grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2">
                <input
                  className="size-4 accent-emerald-700"
                  checked={selected.include_in_toc}
                  onChange={(event) =>
                    updateSelected({
                      include_in_toc: event.currentTarget.checked,
                    })
                  }
                  type="checkbox"
                />
                显示在目录
              </label>
              <label className="flex items-center gap-2">
                <input
                  className="size-4 accent-emerald-700"
                  checked={selected.starts_page}
                  onChange={(event) =>
                    updateSelected({
                      starts_page: event.currentTarget.checked,
                    })
                  }
                  type="checkbox"
                />
                从此标题开始新页面
              </label>
            </div>
          </>
        )}
      </>
    );
  }

  function renderSourceHandling(titleId: string) {
    return (
      <>
        <h2 className="text-base font-bold" id={titleId}>
          源处理
        </h2>
        {props.typography && (
          <dl className="source-processing-summary my-4 grid grid-cols-2 gap-2">
            <div className="bg-stone-100 p-3">
              <dt className="text-xs text-stone-600">排版方式</dt>
              <dd className="mt-1 font-semibold">{props.typography.profile}</dd>
            </div>
            <div className="bg-stone-100 p-3">
              <dt className="text-xs text-stone-600">补齐空格</dt>
              <dd className="mt-1 font-semibold">
                {props.typography.spaces_normalized}
              </dd>
            </div>
            <div className="bg-stone-100 p-3">
              <dt className="text-xs text-stone-600">转换标点</dt>
              <dd className="mt-1 font-semibold">
                {props.typography.punctuation_converted}
              </dd>
            </div>
            <div className="bg-stone-100 p-3">
              <dt className="text-xs text-stone-600">保护节点</dt>
              <dd className="mt-1 font-semibold">
                {props.typography.protected_nodes}
              </dd>
            </div>
          </dl>
        )}
      </>
    );
  }

  const dirtyChanges = nodes.flatMap((node, index) => {
    const initial = initialNodes[index];
    if (!initial || JSON.stringify(initial) === JSON.stringify(node)) return [];
    const change: Record<string, unknown> = { block_id: node.block_id };
    for (const key of [
      "display_level",
      "include_in_toc",
      "starts_page",
    ] as const) {
      if (node[key] !== initial[key]) change[key] = node[key];
    }
    for (const key of ["display_title", "role"] as const) {
      if (node[key] !== initial[key]) change[key] = node[key] ?? null;
    }
    return [change];
  });
  const dirty = dirtyChanges.length > 0;

  async function save() {
    if (!dirty || saving || props.saveDisabled) return;
    setSaving(true);
    setStatus("");
    setConflict(false);
    const submittedNodes = nodesRef.current;
    try {
      const response = await fetch(`/api/manage/books/${props.bookId}/draft`, {
        body: JSON.stringify({
          changes: dirtyChanges,
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "If-Match": props.etag,
        },
        method: "PATCH",
      });
      if (response.status === 412) {
        setConflict(true);
        setStatus("草稿已在其他页面更新。本地修改仍保留，请重新载入后再处理。");
        return;
      }
      if (!response.ok) {
        setStatus("修改未保存，请检查层级、角色和诊断信息。");
        return;
      }
      acceptedSnapshot.current = {
        nodes: submittedNodes,
      };
      await props.onSaved();
    } catch {
      setStatus("配置保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  useImperativeHandle(ref, () => ({
    save() {
      void save();
    },
  }));

  useEffect(() => {
    onStateChange({ conflict, dirty, saving });
  }, [conflict, dirty, onStateChange, saving]);

  return (
    <section
      className="structure-editor mt-8 border-t border-stone-200 pt-4"
      aria-label="结构编辑"
    >
      <div className="structure-search grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <Search aria-hidden="true" size={18} />
        <label className="m-0">
          <span className="sr-only">搜索结构</span>
          <input
            className={manageField}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索标题"
            type="search"
            value={query}
          />
        </label>
      </div>
      <div
        className="structure-virtual-list my-4 h-88 overflow-auto rounded-lg border border-stone-200"
        ref={listParent}
      >
        <ol
          className="structure-tree relative m-0 list-none p-0"
          role="tree"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const node = visibleNodes[item.index];
            if (!node) return null;
            const heading = headingById.get(node.block_id);
            const expandable = expandableIds.has(node.block_id);
            const expanded = expandable && !collapsedIds.has(node.block_id);
            return (
              <li
                aria-expanded={expandable ? expanded : undefined}
                aria-level={node.display_level}
                className="absolute inset-x-0 w-full"
                key={node.block_id}
                role="treeitem"
                style={{
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div className="flex h-full border-b border-stone-200 bg-white">
                  {expandable ? (
                    <button
                      aria-label={expanded ? "折叠子项" : "展开子项"}
                      className="grid size-11 shrink-0 place-items-center text-stone-600 hover:bg-stone-100"
                      onClick={() =>
                        setCollapsedIds((current) => {
                          const next = new Set(current);
                          if (expanded) next.add(node.block_id);
                          else next.delete(node.block_id);
                          return next;
                        })
                      }
                      type="button"
                    >
                      {expanded ? (
                        <ChevronDown aria-hidden="true" size={18} />
                      ) : (
                        <ChevronRight aria-hidden="true" size={18} />
                      )}
                    </button>
                  ) : (
                    <span className="size-11 shrink-0" />
                  )}
                  <button
                    aria-current={node.block_id === selectedId}
                    className="h-full min-w-0 flex-1 truncate bg-white pe-2 text-start text-stone-800 hover:bg-stone-50 aria-[current=true]:bg-emerald-50 aria-[current=true]:text-emerald-900"
                    onClick={() => setSelectedId(node.block_id)}
                    style={{
                      paddingInlineStart: `${Math.max(0, node.display_level - 1) * 16 + 8}px`,
                    }}
                    type="button"
                  >
                    {node.display_title ??
                      heading?.source_title ??
                      heading?.title ??
                      node.block_id}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mobile-detail-actions mt-4 hidden items-center gap-2 max-[850px]:flex">
        <button
          className={manageSecondaryButton}
          onClick={() => selectedDialog.current?.showModal()}
          ref={selectedDialogTrigger}
          type="button"
        >
          <FilePenLine aria-hidden="true" size={18} />
          当前项
        </button>
        {props.typography && (
          <button
            className={manageSecondaryButton}
            onClick={() => sourceDialog.current?.showModal()}
            ref={sourceDialogTrigger}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={18} />
            源处理
          </button>
        )}
      </div>

      <div className="selected-node-editor desktop-node-editor min-h-80 border-t border-stone-200 pt-4 max-[850px]:hidden">
        {renderSelectedNode("desktop-editor-title")}
      </div>

      {props.typography && (
        <details className="desktop-source-regions max-[850px]:hidden">
          <summary>源处理</summary>
          <div>{renderSourceHandling("desktop-source-title")}</div>
        </details>
      )}

      <dialog
        aria-labelledby="mobile-editor-title"
        className={`workbench-mobile-dialog ${manageDialog}`}
        onClose={() => selectedDialogTrigger.current?.focus()}
        ref={selectedDialog}
      >
        <header className={manageDialogHeader}>
          <span>结构编辑</span>
          <button
            aria-label="关闭当前项编辑"
            className={manageDialogClose}
            onClick={() => selectedDialog.current?.close()}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="workbench-dialog-body p-4 max-[850px]:min-h-[calc(100dvh-3.5rem)] max-[850px]:overflow-auto">
          {renderSelectedNode("mobile-editor-title")}
        </div>
      </dialog>

      {props.typography && (
        <dialog
          aria-labelledby="mobile-source-title"
          className={`workbench-mobile-dialog ${manageDialog}`}
          onClose={() => sourceDialogTrigger.current?.focus()}
          ref={sourceDialog}
        >
          <header className={manageDialogHeader}>
            <span>源处理</span>
            <button
              aria-label="关闭源处理"
              className={manageDialogClose}
              onClick={() => sourceDialog.current?.close()}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </header>
          <div className="workbench-dialog-body p-4 max-[850px]:min-h-[calc(100dvh-3.5rem)] max-[850px]:overflow-auto">
            {renderSourceHandling("mobile-source-title")}
          </div>
        </dialog>
      )}

      <div className="editor-actions mt-4 flex flex-wrap gap-2">
        {status && (
          <button
            className={manageQuietButton}
            onClick={() => void props.onSaved()}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={18} />
            重新载入
          </button>
        )}
      </div>
      {dirty && props.saveDisabled && (
        <p role="status">本地修改尚未反映；当前预览完成前不能再次保存。</p>
      )}
      {status && <p role="alert">{status}</p>}
    </section>
  );
});

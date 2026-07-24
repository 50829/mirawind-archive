import { useMemo, useState } from "react";

type ContentRole = "frontmatter" | "body" | "appendix" | "backmatter";

interface StructureNode {
  readonly block_id: string;
  readonly display_level: number;
  readonly display_title?: string;
  readonly include_in_toc: boolean;
  readonly role?: ContentRole;
  readonly starts_page: boolean;
}

interface HeadingContext {
  readonly block_id: string;
  readonly source_level: number;
  readonly source_title?: string;
  readonly title: string;
}

const roleLabels: Readonly<Record<ContentRole, string>> = {
  appendix: "附录",
  backmatter: "后置内容",
  body: "正文",
  frontmatter: "前置内容",
};

function configStructure(
  config: Readonly<Record<string, unknown>>,
): readonly StructureNode[] {
  return config.structure as readonly StructureNode[];
}

export function StructureEditor(props: {
  readonly bookId: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly etag: string;
  readonly headings: readonly HeadingContext[];
  readonly onSaved: () => Promise<void>;
}) {
  const [nodes, setNodes] = useState<readonly StructureNode[]>(() =>
    configStructure(props.config),
  );
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const headingById = useMemo(
    () => new Map(props.headings.map((heading) => [heading.block_id, heading])),
    [props.headings],
  );

  function update(index: number, change: Partial<StructureNode>) {
    setNodes((current) =>
      current.map((node, nodeIndex) =>
        nodeIndex === index ? { ...node, ...change } : node,
      ),
    );
  }

  function updateDisplayTitle(index: number, value: string) {
    setNodes((current) =>
      current.map((node, nodeIndex) => {
        if (nodeIndex !== index) return node;
        const withoutDisplayTitle = Object.fromEntries(
          Object.entries(node).filter(([key]) => key !== "display_title"),
        ) as unknown as StructureNode;
        return value
          ? { ...withoutDisplayTitle, display_title: value }
          : withoutDisplayTitle;
      }),
    );
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(`/api/manage/books/${props.bookId}/draft`, {
        body: JSON.stringify({
          ...props.config,
          revision: Number(props.config.revision) + 1,
          structure: nodes.map((node) =>
            node.display_level === 1
              ? node
              : Object.fromEntries(
                  Object.entries(node).filter(([key]) => key !== "role"),
                ),
          ),
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "If-Match": props.etag,
        },
        method: "PUT",
      });
      if (response.status === 412) {
        setStatus("草稿已在其他页面更新；已重新载入当前修订。");
        await props.onSaved();
        return;
      }
      if (!response.ok) {
        setStatus("配置未保存。请检查层级、角色和诊断信息。");
        return;
      }
      setStatus("已保存；后台正在生成新预览。");
      await props.onSaved();
    } catch {
      setStatus("配置保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="structure-editor" aria-labelledby="editor-title">
      <h2 id="editor-title">出版结构</h2>
      <p className="quiet">
        可修改显示标题、目录可见性、H1–H4
        层级、顶层内容角色和标题前拆页；正文顺序不会改变。
      </p>
      <ol className="structure-edit-list">
        {nodes.map((node, index) => {
          const heading = headingById.get(node.block_id);
          return (
            <li key={node.block_id}>
              <p className="source-heading">
                源标题：
                {heading?.source_title ?? heading?.title ?? node.block_id}
                {heading ? `（H${heading.source_level}）` : ""}
              </p>
              <label>
                显示标题
                <input
                  maxLength={500}
                  value={node.display_title ?? ""}
                  placeholder={heading?.source_title ?? heading?.title ?? ""}
                  onChange={(event) =>
                    updateDisplayTitle(index, event.target.value)
                  }
                />
              </label>
              <div className="structure-fields">
                <label>
                  显示层级
                  <select
                    value={node.display_level}
                    onChange={(event) =>
                      update(index, {
                        display_level: Number(event.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4].map((level) => (
                      <option key={level} value={level}>
                        H{level}
                      </option>
                    ))}
                  </select>
                </label>
                {node.display_level === 1 && (
                  <label>
                    内容角色
                    <select
                      value={node.role ?? "body"}
                      onChange={(event) =>
                        update(index, {
                          role: event.target.value as ContentRole,
                        })
                      }
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
              <div className="structure-checks">
                <label>
                  <input
                    type="checkbox"
                    checked={node.include_in_toc}
                    onChange={(event) =>
                      update(index, { include_in_toc: event.target.checked })
                    }
                  />
                  显示在目录
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={node.starts_page}
                    onChange={(event) =>
                      update(index, { starts_page: event.target.checked })
                    }
                  />
                  从此标题开始新页面
                </label>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? "正在保存…" : "保存并重建预览"}
      </button>
      {status && <p role="status">{status}</p>}
    </section>
  );
}

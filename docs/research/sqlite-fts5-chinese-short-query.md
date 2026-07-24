# SQLite FTS5 中文短查询 PoC 与 M1 建议

- 调研日期：2026-07-24
- 目标：回答 OQ-011，验证单字、双字、中英混合、专有名词和公式附近文本的搜索行为
- 来源范围：SQLite 官方文档、官方发行记录，以及本机 SQLite FTS5 可复现实验
- PoC 环境：Python `sqlite3` 链接 SQLite 3.46.1，FTS5 和 trigram tokenizer 均可用

## 结论

M1 建议采用以下组合：

1. **正文主索引使用 FTS5 trigram，保持默认 `detail=full`。**
2. **查询经 NFC 和换行规范化后，以 FTS5 双引号短语传入，按“连续字面子串”搜索。**
3. **3 个及以上 Unicode 字符搜索书名、作者、章节标题和正文；1～2 个字符只搜索规模较小的书名、作者和章节标题表。**
4. 短查询回退使用受限 `LIKE`（或等价的 `instr()`）并限制结果数，不扫描完整正文。
5. M1 不使用默认 `unicode61` 作为中文正文主索引，不引入中文分词扩展，也不建立全正文 unigram/bigram 短词表。
6. 界面明确提示：“1～2 个字仅搜索书名、作者和章节标题；输入至少 3 个字搜索正文。”

这是一个有意的 M1 边界：两字正文词（例如正文中的“能量”）不会由短查询命中，除非也出现在书名或章节标题中。若真实使用反馈表明两字正文搜索不可缺少，后续应增加**持久化的 CJK bigram 倒排表**，而不是让大型正文退化为全表 `LIKE` 扫描。

## 为什么不能使用默认 `unicode61`

SQLite 官方说明，`unicode61` 是 FTS5 默认 tokenizer。它把 Unicode 6.1 中字母和数字等视为 token 字符，并把**一整段连续 token 字符**视为一个 token。[SQLite FTS5：Unicode61 Tokenizer](https://www.sqlite.org/fts5.html#the_unicode61_tokenizer)

这对以空格分词的英文有效，但没有中文分词能力。例如：

```text
量子力学研究微观世界。薛定谔方程描述量子态。
```

本机 `fts5vocab` 实际显示为两个正文 token：

```text
量子力学研究微观世界
薛定谔方程描述量子态
```

所以：

- `量子` 不等于 `量子力学研究微观世界`，不命中；
- `力学` 也不命中；
- `量子*` 只可能命中以“量子”开头的完整 token；
- 即使配置 `prefix='1 2 3'`，也只能加速 token 前缀，不能把“力学”变成 token 中间的子串。官方文档也明确区分完整 token 和 prefix query。[SQLite FTS5：Prefix Queries](https://www.sqlite.org/fts5.html#fts5_prefix_queries)、[Prefix Indexes](https://www.sqlite.org/fts5.html#prefix_indexes)

因此，给 `unicode61` 添加 1/2/3 字符 prefix index 并不能解决中文任意位置的一字、二字查询。

## trigram 能解决什么，不能解决什么

SQLite 3.34.0 开始正式加入 FTS5 trigram index。[SQLite 3.34.0 官方发行说明](https://www.sqlite.org/releaselog/3_34_0.html)

trigram 把每段连续的三个 Unicode 字符建立为 token，适合任意位置的连续子串搜索。官方文档同时规定：

- 少于 3 个 Unicode 字符的 full-text query 不会命中任何行；
- trigram 的 `LIKE`/`GLOB` 若没有至少一段 3 字符的非通配内容，会退化为线性扫描；
- `LIKE` 使用 `ESCAPE` 时不能使用 trigram index 优化；
- `detail=none` 或 `detail=column` 时，full-text query 不能可靠支持超过 3 字符的 phrase，因此本项目应保留 `detail=full`。[SQLite FTS5：Trigram Tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)

trigram 的结果符合中文书库的主要需要：

- `量子力`、`张三丰`：命中；
- `OpenAI模型`、`AI模型`：中英连续子串可命中；
- `质量与能量`：可命中公式附近正文；
- `E=mc²`：把标点也作为连续字面内容，可命中原式；
- `量子`、`三丰`、`能量`：只有两个 Unicode 字符，`MATCH` 必然无结果。

## 可复现 PoC

### 运行命令

在项目机器上运行：

```bash
python3 - <<'PY'
import sqlite3

con = sqlite3.connect(":memory:")
con.executescript("""
CREATE TABLE docs(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE VIRTUAL TABLE u61 USING fts5(
  title, body,
  content='docs', content_rowid='id',
  tokenize='unicode61'
);
CREATE VIRTUAL TABLE tri USING fts5(
  title, body,
  content='docs', content_rowid='id',
  tokenize='trigram'
);
""")

rows = [
  (1, "量子力学导论", "量子力学研究微观世界。薛定谔方程描述量子态。"),
  (2, "中国近代史", "中国社会在近代发生深刻变化。"),
  (3, "OpenAI 模型指南", "OpenAI模型支持中文，也支持 English prompts。"),
  (4, "张三丰传", "武当祖师张三丰与太极拳的传说。"),
  (5, "质能关系", "在公式 E=mc² 附近，质量与能量互相联系。"),
  (6, "Python 数据科学", "使用Python处理数据，并通过 NumPy 计算。"),
  (7, "傅里叶变换", "公式 f(x)=∫F(k)e^{ikx}dk 附近讨论频域分析。"),
]
con.executemany("INSERT INTO docs VALUES(?,?,?)", rows)
con.execute("INSERT INTO u61(u61) VALUES('rebuild')")
con.execute("INSERT INTO tri(tri) VALUES('rebuild')")

def phrase(q):
    # 绑定参数只能防 SQL 注入，不能取消 FTS5 查询语法；
    # 因而还要把用户输入编码为 FTS5 双引号短语。
    return '"' + q.replace('"', '""') + '"'

def like_pattern(q):
    return "%" + (
        q.replace("\\", "\\\\")
         .replace("%", "\\%")
         .replace("_", "\\_")
    ) + "%"

queries = [
  "量", "量子", "量子力", "力学", "中国", "近代",
  "OpenAI", "OpenAI模型", "AI模型",
  "张三丰", "三丰",
  "能量", "质量与能量", "E=mc²", "mc²",
  "Python", "Python数据", "f(x)"
]

print("q|chars|unicode61|trigram_MATCH|allfields_LIKE|title_LIKE")
for q in queries:
    uq = [r[0] for r in con.execute(
        "SELECT rowid FROM u61 WHERE u61 MATCH ? ORDER BY rowid",
        (phrase(q),)
    )]
    tq = [r[0] for r in con.execute(
        "SELECT rowid FROM tri WHERE tri MATCH ? ORDER BY rowid",
        (phrase(q),)
    )]
    p = like_pattern(q)
    aq = [r[0] for r in con.execute(
        """SELECT id FROM docs
           WHERE title LIKE ? ESCAPE '\\'
              OR body  LIKE ? ESCAPE '\\'
           ORDER BY id""",
        (p, p)
    )]
    hq = [r[0] for r in con.execute(
        """SELECT id FROM docs
           WHERE title LIKE ? ESCAPE '\\'
           ORDER BY id""",
        (p,)
    )]
    print(f"{q}|{len(q)}|{uq}|{tq}|{aq}|{hq}")
PY
```

应用代码必须像示例一样同时做两件事：

1. 通过 SQLite 参数绑定传值；
2. 把输入编码成一个 FTS5 双引号短语。

只做参数绑定并不会把 `=`、`(`、`)` 等字符变成 FTS5 字面量。本机验证中，直接把 `E=mc²` 或 `f(x)` 交给 `MATCH ?` 会产生 FTS5 语法错误；编码为 `"E=mc²"` 和 `"f(x)"` 后正常命中。

### 结果

行号对应上面七条 fixture：

| 查询 | 字符数 | `unicode61 MATCH` | `trigram MATCH` | 全字段 `LIKE` | 仅标题 `LIKE` |
|---|---:|---|---|---|---|
| 量 | 1 | — | — | 1, 5 | 1 |
| 量子 | 2 | — | — | 1 | 1 |
| 量子力 | 3 | — | 1 | 1 | 1 |
| 力学 | 2 | — | — | 1 | 1 |
| 中国 | 2 | — | — | 2 | 2 |
| 近代 | 2 | — | — | 2 | 2 |
| OpenAI | 6 | 3 | 3 | 3 | 3 |
| OpenAI模型 | 8 | — | 3 | 3 | — |
| AI模型 | 4 | — | 3 | 3 | — |
| 张三丰 | 3 | — | 4 | 4 | 4 |
| 三丰 | 2 | — | — | 4 | 4 |
| 能量 | 2 | — | — | 5 | — |
| 质量与能量 | 5 | — | 5 | 5 | — |
| E=mc² | 5 | 5 | 5 | 5 | — |
| mc² | 3 | 5 | 5 | 5 | — |
| Python | 6 | 6 | 6 | 6 | 6 |
| Python数据 | 8 | — | — | — | — |
| f(x) | 4 | 7 | 7 | 7 | — |

`Python数据` 不命中是正确的：fixture 正文是“Python处理数据”，不存在这个连续子串。这也说明 M1 的建议是**字面子串搜索**，不是自动分词后的“Python AND 数据”查询。

### 公式语义差异

额外实验：

```sql
-- unicode61
SELECT rowid FROM u61 WHERE u61 MATCH '"E-mc²"'; -- 命中

-- trigram
SELECT rowid FROM tri WHERE tri MATCH '"E-mc²"'; -- 不命中
```

fixture 实际写的是 `E=mc²`。`unicode61` 把 `=` 和 `-` 都当分隔符，所以两种查询都近似为相邻 token `e`、`mc²`；trigram 保留连续字符差异，因此更符合公式字面搜索。最终集成仍要使用 D-058 确定的“渲染后可见文本 + NFC”作为索引输入，并用真实 KaTeX fixture 验证可见公式文本。

## `LIKE` 回退的成本

SQLite 普通 B-tree 对前置 `%` 的 `LIKE '%查询%'` 不能使用 LIKE 范围优化；官方要求右侧 pattern 不能以通配符开头。[SQLite Query Optimizer：LIKE Optimization](https://www.sqlite.org/optoverview.html#the_like_optimization)

SQLite 内建 `LIKE` 默认也只对 ASCII 大小写折叠，非 ASCII 字符默认区分大小写。[SQLite 表达式文档：LIKE](https://www.sqlite.org/lang_expr.html#the_like_glob_regexp_match_and_extract_operators)

因此标题回退仍是扫描，只是扫描的数据集很小。它应针对“每本书一条元数据 + 每个章节一条标题”的专用关系，而不是版本内所有正文块。

本机用 50,000 条合成记录做了 15 次热查询，取中位数。数据中只有一条“量子力学导论”，正文长度约 24 个汉字：

| 查询方式 | 中位耗时 |
|---|---:|
| 普通表仅标题 `LIKE '%量子%'` | 2.922 ms |
| 普通表标题或正文 `LIKE '%量子%'` | 7.930 ms |
| trigram 标题 `LIKE '%量子%'`（不足 3 字，内部线性扫描） | 6.188 ms |
| trigram `MATCH '"量子力"'` | 0.007 ms |
| trigram 标题 `LIKE '%量子力%'` | 0.011 ms |

这些数字只说明复杂度差异，不是生产性能承诺；它们受 CPU、缓存、正文长度和命中数量影响。官方文档已经确定“不足 3 字的 trigram LIKE 会线性扫描”，所以不能因小样本很快就把它用于最大 256 MiB 的正文。

同一份 10,000 行合成数据中，包含正文副本的 SQLite 数据库序列化大小约为：

| tokenizer | 大小 |
|---|---:|
| unicode61 | 1,548,288 bytes |
| trigram | 2,650,112 bytes |

这个约 1.71 倍的比例同样只适用于该合成语料。trigram 会为重叠三字符片段建立更多索引项，正式容量应在代表性 MinerU 大书 fixture 上重新测量。

## M1 数据与查询建议

### 1. 主索引

概念结构：

```sql
CREATE VIRTUAL TABLE search_fts USING fts5(
  title,
  author,
  heading,
  body,
  book_id UNINDEXED,
  version_id UNINDEXED,
  page_id UNINDEXED,
  block_id UNINDEXED,
  tokenize='trigram',
  detail='full'
);
```

具体选择普通 content、external content 或其他存储方式应由数据库架构统一确定；如果采用 external content，SQLite 官方要求应用自行保证内容表和 FTS 索引一致，否则查询结果不可预测。[SQLite FTS5：External Content Table Pitfalls](https://www.sqlite.org/fts5.html#external_content_table_pitfalls)

无论采用哪种存储方式，都必须遵守已经确认的发布边界：

- 索引行带 `version_id`；
- 匿名查询连接 `books.current_version_id` 并过滤 `public`；
- 管理员只搜索自己有权访问的范围；
- `ready` 或旧版本不能因 FTS 命中而泄漏；
- FTS 写入和发布状态按 D-077 的事务协议处理。

### 2. 三字及以上查询

处理流程：

1. 去除首尾空白；
2. 按 D-058 对查询执行与索引相同的 NFC、换行规范化；
3. 按 Unicode code point 计数，而不是 UTF-8 字节数或 JavaScript UTF-16 code unit；
4. 将输入编码为单个 FTS5 双引号短语；
5. 参数绑定执行 `MATCH`；
6. 权限和 `current_version_id` 过滤与查询处于同一条 SQL 或同一受控查询路径；
7. 结果数设硬上限。

标题权重可通过官方 `bm25()` 的逐列权重调高，或使用 `rank` 排序；正式权重需要真实书籍 fixture 调参。[SQLite FTS5：BM25](https://www.sqlite.org/fts5.html#the_bm25_function)

### 3. 一字、二字查询

只在以下专用数据中回退：

- 书名；
- 作者；
- 章节标题。

安全的 `LIKE` 形态：

```sql
SELECT book_id, page_id, block_id, kind, normalized_text
FROM search_titles
WHERE normalized_text LIKE :escaped_pattern ESCAPE '\'
  AND /* public/current-version 或管理员权限条件 */
ORDER BY /* 书名优先、章节标题其次 */
LIMIT 50;
```

应用必须依次转义 `\`、`%` 和 `_` 后，再在两端添加 `%`。也可以使用不具备通配符语义的 `instr(normalized_text, :query) > 0`，两者在此处都是受限扫描。

不建议：

- 对所有正文块执行 `LIKE '%二字%'`；
- 在 trigram 表上对二字执行 `LIKE` 并误以为使用了索引；
- 只加 `prefix='1 2'` 后继续使用 `unicode61`；
- 静默返回空结果而不解释正文最短查询长度。

### 4. 暂不增加的能力

M1 不需要中文分词扩展。原因不是分词没有价值，而是当前目标是跨中文、英文、专有名词和公式的连续字面查找；trigram 已覆盖 3 字以上场景，且没有额外 native extension 的部署负担。

M1 也不建立全正文短词表。若未来必须支持两字正文搜索，推荐新增只包含 CJK bigram 的倒排关系，并在代表性大书上测量：

- 数据库增量大小；
- 构建时间；
- 高频二字词的 posting 数量；
- 当前版本过滤和回收成本；
- 搜索结果质量。

一字正文搜索噪声很高，即使以后增加 bigram，也仍建议限制在元数据和标题。

## 验收条件

M1 搜索实现至少加入以下自动化测试：

1. `unicode61` 不得被误用为中文主索引。
2. `量子力`、`张三丰`、`OpenAI模型`、`AI模型`、`质量与能量`、`E=mc²` 能命中对应块。
3. `量子`、`三丰`、`能量` 走短查询分支，不执行正文 trigram `MATCH` 或正文 `LIKE`。
4. `E=mc²`、`f(x)`、双引号、`*`、`OR`、`-` 等输入不能造成 FTS5 语法注入或 SQL 注入。
5. `%`、`_` 和 `\` 在短查询回退中按字面字符处理。
6. NFC 等价输入产生相同结果；大小写行为有明确 fixture。
7. 匿名搜索无法命中 `draft`、`private`、`ready`、旧版本或孤立 FTS 行。
8. 当前版本切换后，正文与搜索结果在同一个可见边界上切换。
9. 代表性最大书 fixture 记录索引大小、构建时间、三字查询 p95，以及一字/二字标题回退 p95。
10. 界面清楚展示短查询范围，不把“两字正文未搜索”伪装成“整本书没有结果”。

## 最终建议

关闭 OQ-011 时建议记录为：

> M1 的正文搜索使用 SQLite FTS5 trigram、`detail=full` 和安全编码的字面 phrase query。3 个及以上 Unicode 字符搜索元数据、章节标题与正文；1～2 个字符只对书名、作者和章节标题执行受限扫描，正文不执行线性 `LIKE`。M1 不引入中文分词扩展或全正文短词表；若后续必须支持两字正文搜索，以经过容量和质量 PoC 的 CJK bigram 倒排表扩展。搜索索引继续遵守当前版本和可见性过滤。

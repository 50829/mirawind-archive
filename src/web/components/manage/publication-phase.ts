const phaseLabels: Readonly<Record<string, string>> = {
  complete: "完成原子切换",
  finalizing: "验证并准备切换",
  indexing: "建立书内搜索",
  publishing: "切换当前版本",
  queued: "等待后台处理",
  rendering: "生成阅读页面",
  starting: "准备发布环境",
  validating: "校验图书配置",
};

export function publicationPhaseLabel(phase: string): string {
  return phaseLabels[phase] ?? "正在构建";
}

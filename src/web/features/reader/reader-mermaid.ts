import mermaid from "mermaid";

const maximumDiagramsPerPage = 32;

function failDiagram(frame: HTMLElement, message: string): void {
  frame.dataset.mermaidState = "failed";
  const source = frame.querySelector("[data-mermaid-source]");
  if (source instanceof HTMLElement) source.hidden = false;
  const status = frame.querySelector("[data-mermaid-status]");
  if (status instanceof HTMLElement) status.textContent = message;
}

export async function renderMermaidDiagrams(root: ParentNode): Promise<void> {
  const frames = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid-diagram]"),
  );
  if (frames.length === 0) return;

  mermaid.initialize({
    flowchart: { htmlLabels: false },
    htmlLabels: false,
    logLevel: "fatal",
    maxTextSize: 50_000,
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: "neutral",
  });

  for (const [index, frame] of frames.entries()) {
    if (index >= maximumDiagramsPerPage) {
      failDiagram(frame, "本页图表过多，已保留源码。");
      continue;
    }
    const source = frame.querySelector("[data-mermaid-source]");
    const status = frame.querySelector("[data-mermaid-status]");
    if (!(source instanceof HTMLElement)) continue;
    frame.dataset.mermaidState = "loading";
    if (status instanceof HTMLElement) status.textContent = "正在渲染图表";
    try {
      const result = await mermaid.render(
        `mirawind-mermaid-${index}-${crypto.randomUUID()}`,
        source.textContent ?? "",
      );
      const output = document.createElement("div");
      output.className = "mermaid-output";
      output.innerHTML = result.svg;
      const svg = output.querySelector("svg");
      if (!(svg instanceof SVGElement)) throw new Error("MERMAID_SVG_MISSING");
      if (
        !svg.hasAttribute("aria-label") &&
        !svg.hasAttribute("aria-labelledby")
      ) {
        svg.setAttribute("aria-label", "图表");
      }
      if (!svg.hasAttribute("role")) svg.setAttribute("role", "img");
      frame.insertBefore(output, source);
      source.hidden = true;
      if (status instanceof HTMLElement) status.textContent = "";
      frame.dataset.mermaidState = "complete";
    } catch {
      failDiagram(frame, "图表无法渲染，已保留源码。");
    }
  }
}

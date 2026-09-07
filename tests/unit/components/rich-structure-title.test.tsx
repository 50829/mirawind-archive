// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  FormulaTrial,
  RichStructureTitle,
} from "@/web/components/manage/RichStructureTitle";

afterEach(cleanup);

describe("workbench rich title trials", () => {
  it("renders inline heading formulae with KaTeX", () => {
    const source = "p\\gg N";
    const view = render(
      <RichStructureTitle
        markdown={`High-Dimensional Problems: $${source}$`}
      />,
    );

    expect(view.container.querySelector("math annotation")?.textContent).toBe(
      source,
    );
  });

  it("renders an editable display formula trial", () => {
    const source = "\\sum_{i=1}^{n} x_i";
    const view = render(<FormulaTrial source={source} />);

    expect(view.container.querySelector("math annotation")?.textContent).toBe(
      source,
    );
  });
});

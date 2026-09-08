import { describe, expect, it } from "vitest";
import { importMineruContent } from "@/modules/publishing/core/preparation/mineru-content";
import { createRenderingDocument } from "@/modules/publishing/core/content/rendering-document";
import { detectPrintedContents } from "@/modules/publishing/core/preparation/printed-contents";
import { mineruTitle, mineruParagraph } from "../../helpers/mineru-v2";

describe("JSON contents recovery", () => {
  it("does not replace clean printed labels with decorated OCR body labels", () => {
    const imported = importMineruContent(
      [
        [
          mineruTitle("目录"),
          mineruParagraph("习题 2B ...... 35"),
          mineruParagraph("习题 2C ...... 40"),
          mineruParagraph("习题 3D ...... 78"),
        ],
        [
          mineruTitle("K习题2Bk"),
          mineruParagraph("Body"),
          mineruTitle("K习题2C k"),
          mineruParagraph("Body"),
          mineruTitle("K习题3Dk"),
        ],
      ],
      { bookId: 1, nowMs: 1000, title: "Book" },
    );
    const result = detectPrintedContents({
      document: createRenderingDocument(imported.book),
    });
    expect(
      result.candidates[0]?.logicalEntries.map((entry) => entry.sourceTitle),
    ).toEqual(["习题 2B ...... 35", "习题 2C ...... 40", "习题 3D ...... 78"]);
  });
});

interface ProtectedRange {
  readonly end: number;
  readonly start: number;
}

const horizontalWhitespace =
  "[\\t\\f\\v \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]";

const horizontalWhitespacePattern = new RegExp(horizontalWhitespace, "u");
const leadingHorizontalWhitespacePattern = new RegExp(
  `^${horizontalWhitespace}*`,
  "u",
);
const trailingHorizontalWhitespacePattern = new RegExp(
  `${horizontalWhitespace}*$`,
  "u",
);

const horizontalWhitespaceAtStartPattern = new RegExp(
  `^${horizontalWhitespace}`,
  "u",
);

const horizontalWhitespaceAtEndPattern = new RegExp(
  `${horizontalWhitespace}$`,
  "u",
);

const whitespaceBeforeClosingPunctuationPattern = new RegExp(
  `${horizontalWhitespace}+(?=[，。；：？！）》」』】])`,
  "gu",
);

const whitespaceAfterOpeningPunctuationPattern = new RegExp(
  `(?<=[（《“‘「『【])${horizontalWhitespace}+`,
  "gu",
);

const whitespaceBetweenClosingAndChinesePattern = new RegExp(
  `(?<=[，。；：？！）》」』】])${horizontalWhitespace}+(?=[\\p{Script=Han}（《“‘「『【])`,
  "gu",
);

const whitespaceBeforeOpeningPunctuationPattern = new RegExp(
  `(?<=[\\p{Script=Han}）》」』】”’])${horizontalWhitespace}+(?=[（《“‘「『【])`,
  "gu",
);

const forwardMixedSpacingPattern = new RegExp(
  `(\\p{Script=Han})(${horizontalWhitespace}*)([\\p{Script=Latin}0-9])`,
  "gu",
);

const backwardMixedSpacingPattern = new RegExp(
  `([\\p{Script=Latin}0-9])(${horizontalWhitespace}*)(\\p{Script=Han})`,
  "gu",
);

const hanPattern = /\p{Script=Han}/u;

const latinOrDigitPattern = /[\p{Script=Latin}0-9]/u;

const chinesePunctuationPattern = /[，。；：？！、（）《》“”‘’「」『』【】]/u;

const closingPunctuationPattern = /[”’）》」』】]/u;

const punctuationReplacements = new Map([
  [",", "，"],
  [";", "；"],
  [":", "："],
  ["?", "？"],
  ["!", "！"],
]);

const technicalTokenPattern =
  /(?:10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)|(?:ISBN(?:-1[03])?:?\s*(?:97[89][-\s]?)?\d(?:[-\s]?\d){8,12}[\dX])|(?:(?:https?|ftp):\/\/|www\.)[^\s<>\p{Script=Han}]+|(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(?:--?[A-Za-z][A-Za-z0-9_-]*(?:=(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>`]+))?)|(?:(?:[A-Za-z]:\\|\.{0,2}\/|\/)[^\s<>"'`]*?\.[A-Za-z0-9]{1,12}(?=$|\s|\p{Script=Han}))|(?:(?:[A-Za-z]:\\|\.{0,2}\/|\/)[^\s<>"'`，。；：？！]+)|(?:\bv?\d+(?:\.\d+){1,}\b)|(?:\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b)|(?:\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)|(?:\b\d+\.\d+\b)|(?:\b[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}\b)/gu;

function protectedRanges(value: string): readonly ProtectedRange[] {
  technicalTokenPattern.lastIndex = 0;
  return Object.freeze(
    [...value.matchAll(technicalTokenPattern)].map((match) =>
      Object.freeze({
        end: (match.index ?? 0) + match[0].length,
        start: match.index ?? 0,
      }),
    ),
  );
}

function isProtected(
  ranges: readonly ProtectedRange[],
  index: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (index < range.start) high = middle - 1;
    else if (index >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function previousVisibleCharacter(value: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = value[cursor] ?? "";
    if (!horizontalWhitespacePattern.test(character)) {
      return character;
    }
  }
  return "";
}

function nextVisibleCharacter(value: string, index: number): string {
  for (let cursor = index + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor] ?? "";
    if (!horizontalWhitespacePattern.test(character)) {
      return character;
    }
  }
  return "";
}

function isChineseContextCharacter(value: string): boolean {
  return hanPattern.test(value) || chinesePunctuationPattern.test(value);
}

function normalizePunctuation(value: string): {
  readonly converted: number;
  readonly ranges: readonly ProtectedRange[];
  readonly value: string;
} {
  let output = value;
  let converted = 0;
  let ranges = protectedRanges(output);

  const beforeEllipsis = output;
  output = output.replace(/(?<!\.)\.{3}(?!\.)/gu, (match, offset: number) => {
    if (
      [0, 1, 2].some((delta) => isProtected(ranges, offset + delta)) ||
      (!isChineseContextCharacter(previousVisibleCharacter(output, offset)) &&
        !isChineseContextCharacter(nextVisibleCharacter(output, offset + 2)))
    ) {
      return match;
    }
    converted += 1;
    return "……";
  });
  if (output !== beforeEllipsis) ranges = protectedRanges(output);

  const characters = [...output];
  const pairStack: number[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === "(" && !isProtected(ranges, index)) {
      pairStack.push(index);
    } else if (
      characters[index] === ")" &&
      !isProtected(ranges, index) &&
      pairStack.length > 0
    ) {
      const start = pairStack.pop();
      if (start === undefined) continue;
      const inside = characters.slice(start + 1, index).join("");
      const outsideLeft = previousVisibleCharacter(output, start);
      const outsideRight = nextVisibleCharacter(output, index);
      if (
        hanPattern.test(inside) ||
        hanPattern.test(outsideLeft) ||
        hanPattern.test(outsideRight)
      ) {
        characters[start] = "（";
        characters[index] = "）";
        converted += 2;
      }
    }
  }

  let openQuote: number | undefined;
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] !== '"' || isProtected(ranges, index)) continue;
    if (openQuote === undefined) {
      openQuote = index;
      continue;
    }
    const inside = characters.slice(openQuote + 1, index).join("");
    const outsideLeft = previousVisibleCharacter(output, openQuote);
    const outsideRight = nextVisibleCharacter(output, index);
    if (
      hanPattern.test(inside) ||
      hanPattern.test(outsideLeft) ||
      hanPattern.test(outsideRight)
    ) {
      characters[openQuote] = "“";
      characters[index] = "”";
      converted += 2;
    }
    openQuote = undefined;
  }

  for (let index = 0; index < characters.length; index += 1) {
    const replacement = punctuationReplacements.get(characters[index] ?? "");
    if (!replacement || isProtected(ranges, index)) continue;
    if (
      isChineseContextCharacter(previousVisibleCharacter(output, index)) ||
      isChineseContextCharacter(nextVisibleCharacter(output, index))
    ) {
      characters[index] = replacement;
      converted += 1;
    }
  }
  output = characters.join("");

  const withPeriods = [...output];
  for (let index = 0; index < withPeriods.length; index += 1) {
    if (withPeriods[index] !== "." || isProtected(ranges, index)) continue;
    const left = previousVisibleCharacter(output, index);
    const right = nextVisibleCharacter(output, index);
    if (
      (hanPattern.test(left) || closingPunctuationPattern.test(left)) &&
      (!right ||
        right === "\n" ||
        hanPattern.test(right) ||
        closingPunctuationPattern.test(right))
    ) {
      withPeriods[index] = "。";
      converted += 1;
    }
  }

  return Object.freeze({ converted, ranges, value: withPeriods.join("") });
}

function normalizeUnprotectedSpacing(
  value: string,
  ranges: readonly ProtectedRange[],
): {
  readonly normalized: number;
  readonly value: string;
} {
  let normalized = 0;
  const normalizeSegment = (segment: string): string => {
    let output = segment
      .replace(whitespaceBeforeClosingPunctuationPattern, "")
      .replace(whitespaceAfterOpeningPunctuationPattern, "")
      .replace(whitespaceBetweenClosingAndChinesePattern, "")
      .replace(whitespaceBeforeOpeningPunctuationPattern, "");
    output = output.replace(
      forwardMixedSpacingPattern,
      (_match, left: string, spaces: string, right: string) => {
        if (spaces !== " ") normalized += 1;
        return `${left} ${right}`;
      },
    );
    output = output.replace(
      backwardMixedSpacingPattern,
      (_match, left: string, spaces: string, right: string) => {
        if (spaces !== " ") normalized += 1;
        return `${left} ${right}`;
      },
    );
    return output;
  };
  let cursor = 0;
  let output = "";
  for (const [rangeIndex, range] of ranges.entries()) {
    let before = normalizeSegment(value.slice(cursor, range.start));
    const token = value.slice(range.start, range.end);
    const left = boundaryCharacters(before).last;
    const tokenFirst = boundaryCharacters(token).first;
    if (
      before &&
      needsMixedSpace(left, tokenFirst) &&
      !horizontalWhitespaceAtEndPattern.test(before)
    ) {
      before += " ";
      normalized += 1;
    }
    output += before + token;
    cursor = range.end;
    const next = value.slice(cursor, ranges[rangeIndex + 1]?.start);
    const tokenLast = boundaryCharacters(token).last;
    const nextFirst = boundaryCharacters(next).first;
    if (
      next &&
      needsMixedSpace(tokenLast, nextFirst) &&
      !horizontalWhitespaceAtStartPattern.test(next)
    ) {
      output += " ";
      normalized += 1;
    }
  }
  output += normalizeSegment(value.slice(cursor));
  return Object.freeze({ normalized, value: output });
}

export function normalizeContentText(value: string): {
  readonly protectedTokens: number;
  readonly punctuationConverted: number;
  readonly spacesNormalized: number;
  readonly value: string;
} {
  const punctuation = normalizePunctuation(value);
  const spacing = normalizeUnprotectedSpacing(
    punctuation.value,
    punctuation.ranges,
  );
  return Object.freeze({
    protectedTokens: punctuation.ranges.length,
    punctuationConverted: punctuation.converted,
    spacesNormalized: spacing.normalized,
    value: spacing.value,
  });
}

function boundaryCharacters(value: string): {
  readonly first: string;
  readonly last: string;
} {
  const withoutLeading = value.replace(leadingHorizontalWhitespacePattern, "");
  const withoutTrailing = value.replace(
    trailingHorizontalWhitespacePattern,
    "",
  );
  return {
    first: [...withoutLeading][0] ?? "",
    last: [...withoutTrailing].at(-1) ?? "",
  };
}

function needsMixedSpace(left: string, right: string): boolean {
  return (
    (hanPattern.test(left) && latinOrDigitPattern.test(right)) ||
    (latinOrDigitPattern.test(left) && hanPattern.test(right))
  );
}

import { decodeHTML } from "entities";

interface SourceLine {
  readonly content: string;
  readonly end: number;
  readonly endOfLine: string;
  readonly start: number;
}

function sourceLineAt(source: string, start: number): SourceLine | undefined {
  if (start >= source.length) return undefined;
  let contentEnd = start;
  while (
    contentEnd < source.length &&
    source[contentEnd] !== "\n" &&
    source[contentEnd] !== "\r"
  ) {
    contentEnd += 1;
  }
  let end = contentEnd;
  if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
  else if (source[end] === "\r" || source[end] === "\n") end += 1;
  return {
    content: source.slice(start, contentEnd),
    end,
    endOfLine: source.slice(contentEnd, end),
    start,
  };
}

function isMineruAlgorithmOpening(line: string): boolean {
  const tag = /^\s*<div\b([^>]*)>\s*$/iu.exec(line);
  if (!tag) return false;
  const classAttribute = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(
    tag[1] ?? "",
  );
  const classes = (classAttribute?.[1] ?? classAttribute?.[2] ?? "")
    .trim()
    .split(/\s+/u);
  return classes.includes("mineru-algorithm");
}

function codeFenceFor(content: string): string {
  let longestRun = 0;
  let currentRun = 0;
  for (const character of content) {
    if (character === "`") {
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
    } else {
      currentRun = 0;
    }
  }
  return "`".repeat(Math.max(3, longestRun + 1));
}

const closingDiv = /^\s*<\/div>\s*$/iu;
const functionCallHeading =
  /^\s{0,3}#{1,6}[ \t]+(?<code>[a-z][A-Za-z0-9_.]*\s*\(.*\)\s*;?)[ \t]*$/u;
const functionCallLine = /^\s*[a-z][A-Za-z0-9_.]*\s*\(.*\)\s*;?\s*$/u;

function codeFromMarkdown(value: string): string {
  return value.trim().replace(/\\_/gu, "_");
}

function normalizeMineruCommandBlocks(source: string): string {
  const output: string[] = [];
  let cursor = 0;
  let retainedStart = 0;
  while (cursor < source.length) {
    const heading = sourceLineAt(source, cursor);
    if (!heading) break;
    cursor = heading.end;
    const match = functionCallHeading.exec(heading.content);
    if (!match?.groups?.code) continue;

    let command: SourceLine | undefined;
    let commandCursor = heading.end;
    while (commandCursor < source.length) {
      const line = sourceLineAt(source, commandCursor);
      if (!line) break;
      commandCursor = line.end;
      if (!line.content.trim()) continue;
      if (functionCallLine.test(line.content)) command = line;
      break;
    }
    if (!command) continue;

    const endOfLine = heading.endOfLine || command.endOfLine || "\n";
    const content = [
      codeFromMarkdown(match.groups.code),
      codeFromMarkdown(command.content),
    ].join(endOfLine);
    const fence = codeFenceFor(content);
    output.push(
      source.slice(retainedStart, heading.start),
      `${fence}r${endOfLine}`,
      content,
      endOfLine,
      fence,
      command.endOfLine,
    );
    retainedStart = command.end;
    cursor = command.end;
  }
  if (output.length === 0) return source;
  output.push(source.slice(retainedStart));
  return output.join("");
}

function normalizeMineruAlgorithmBlocks(source: string): string {
  const output: string[] = [];
  let cursor = 0;
  let retainedStart = 0;
  while (cursor < source.length) {
    const opening = sourceLineAt(source, cursor);
    if (!opening) break;
    cursor = opening.end;
    if (!opening || !isMineruAlgorithmOpening(opening.content)) {
      continue;
    }
    let closing: SourceLine | undefined;
    let closingCursor = opening.end;
    while (closingCursor < source.length) {
      const line = sourceLineAt(source, closingCursor);
      if (!line) break;
      closingCursor = line.end;
      if (closingDiv.test(line.content)) {
        closing = line;
        break;
      }
    }
    if (!closing) break;
    const endOfLine = opening.endOfLine || closing.endOfLine || "\n";
    const content = decodeHTML(source.slice(opening.end, closing.start));
    const fence = codeFenceFor(content);
    output.push(
      source.slice(retainedStart, opening.start),
      `${fence}text${endOfLine}`,
      content,
      content.endsWith("\n") || content.endsWith("\r") ? "" : endOfLine,
      fence,
      closing.endOfLine,
    );
    retainedStart = closing.end;
    cursor = closing.end;
  }
  if (output.length === 0) return source;
  output.push(source.slice(retainedStart));
  return output.join("");
}

export function normalizeMineruPreformattedMarkdown(source: string): string {
  return normalizeMineruAlgorithmBlocks(normalizeMineruCommandBlocks(source));
}

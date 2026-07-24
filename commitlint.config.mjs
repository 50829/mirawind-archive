const allowedTypes = [
  "feat",
  "fix",
  "docs",
  "test",
  "refactor",
  "perf",
  "build",
  "ci",
  "chore",
  "revert",
];

const preferredScopes = [
  "auth",
  "import",
  "archive",
  "compiler",
  "manifest",
  "publish",
  "reader",
  "search",
  "worker",
  "storage",
  "cli",
  "schemas",
  "docs",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", allowedTypes],
  },
  prompt: {
    questions: {
      type: {
        enum: Object.fromEntries(
          allowedTypes.map((type) => [type, { description: type }]),
        ),
      },
      scope: {
        enum: Object.fromEntries(
          preferredScopes.map((scope) => [
            scope,
            { description: `${scope} subsystem` },
          ]),
        ),
      },
    },
  },
};

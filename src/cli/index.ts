const usage = `Usage:
  pnpm mirawind admin bootstrap --data-dir <absolute-path>
  pnpm mirawind admin recover --data-dir <absolute-path>
`;

const [group, command] = process.argv.slice(2);

if (group === undefined || command === undefined) {
  process.stderr.write(usage);
  process.exitCode = 2;
} else if (group !== "admin" || !["bootstrap", "recover"].includes(command)) {
  process.stderr.write(`Unsupported command.\n${usage}`);
  process.exitCode = 2;
} else {
  process.stderr.write(
    `ADMIN_${command.toUpperCase()}_NOT_IMPLEMENTED: complete the foundational authentication tasks first.\n`,
  );
  process.exitCode = 3;
}

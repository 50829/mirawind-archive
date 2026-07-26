import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const expectedUid = 10001;
const dataDirectory = process.env.MIRAWIND_DATA_DIR ?? "/var/lib/mirawind";

function assertDataDirectoryAccess() {
  accessSync(dataDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
}

function workerIsRunningAsApplicationUser() {
  for (const entry of readdirSync("/proc")) {
    if (!/^[1-9][0-9]*$/u.test(entry)) continue;
    try {
      const command = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      if (!command.includes("dist/processes/worker/index.js")) continue;
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      const uid = /^Uid:\s+([0-9]+)/mu.exec(status);
      if (Number(uid?.[1]) === expectedUid) return true;
    } catch {
      // A process may exit between the directory and file reads.
    }
  }
  return false;
}

function assertDocumentTools() {
  for (const [command, versionArgument] of [
    ["pdfinfo", "-v"],
    ["pdftoppm", "-v"],
    ["pdftotext", "-v"],
    ["tesseract", "--version"],
  ]) {
    execFileSync(command, [versionArgument], {
      stdio: "ignore",
      timeout: 4_000,
    });
  }
  const languages = execFileSync("tesseract", ["--list-langs"], {
    encoding: "utf8",
    timeout: 4_000,
  });
  for (const language of ["eng", "chi_sim"]) {
    if (!languages.split(/\r?\n/u).includes(language)) {
      throw new Error("WORKER_DOCUMENT_LANGUAGE_MISSING");
    }
  }
}

async function checkWeb() {
  const publicOrigin = new URL(
    process.env.MIRAWIND_PUBLIC_ORIGIN ?? "http://localhost",
  );
  const response = await fetch("http://127.0.0.1:4321/", {
    headers: { Host: publicOrigin.host },
    redirect: "manual",
    signal: AbortSignal.timeout(4_000),
  });
  await response.body?.cancel();
  if (response.status < 200 || response.status >= 400) {
    throw new Error("WEB_HEALTHCHECK_FAILED");
  }
}

const mode = process.argv[2];
assertDataDirectoryAccess();
if (mode === "web") await checkWeb();
else if (mode === "worker") {
  assertDocumentTools();
  if (!workerIsRunningAsApplicationUser()) {
    throw new Error("WORKER_HEALTHCHECK_FAILED");
  }
} else {
  throw new Error("HEALTHCHECK_MODE_INVALID");
}

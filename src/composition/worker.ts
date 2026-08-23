import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runWorkerMain } from "@/composition/worker/bootstrap";

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) await runWorkerMain();

import type Database from "better-sqlite3";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";

import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/publishing-api";

export function createPublicationServer(
  database: Database.Database,
  layout: StorageLayout,
) {
  return Object.freeze({
    publishCandidate: (input: {
      readonly actorUserId: string | null;
      readonly bookId: number;
      readonly expectedUpdatedAt: number;
      readonly candidateId: string;
      readonly nowMs: number;
    }) =>
      publishCandidate({
        ...input,
        policy: m1PublishPolicy,
        publication: new CandidatePublicationRepository(database, layout),
      }),
  });
}

import type Database from "better-sqlite3";

import { CandidatePublicationRepository } from "@/modules/publishing/adapters/sqlite/candidate-publication";
import {
  m1PublishPolicy,
  publishCandidate,
} from "@/modules/publishing/application/public";

export function createPublicationServer(database: Database.Database) {
  return Object.freeze({
    publishCandidate: (input: {
      readonly actorUserId: string | null;
      readonly bookId: number;
      readonly expectedConfigEtag: string;
      readonly nowMs: number;
    }) =>
      publishCandidate({
        ...input,
        policy: m1PublishPolicy,
        publication: new CandidatePublicationRepository(database),
      }),
  });
}

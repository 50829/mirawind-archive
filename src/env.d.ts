/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly MIRAWIND_ALLOWED_HOSTS?: string;
  readonly MIRAWIND_AUTH_SECRET?: string;
  readonly MIRAWIND_DATA_DIR?: string;
  readonly MIRAWIND_PASSKEY_RP_ID?: string;
  readonly MIRAWIND_PUBLIC_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    requestContext: import("@/http/request-context").RequestContext;
    session:
      import("@/modules/identity/application/public").RequestSession | null;
  }
}

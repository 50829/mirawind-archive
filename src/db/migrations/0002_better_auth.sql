-- Generated from Better Auth 1.6.25 and @better-auth/passkey 1.6.25 using
-- better-auth/db/migration getMigrations(), then reviewed for the M1 policy.

CREATE TABLE "user" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL,
  "image" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATE NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" DATE,
  "refreshTokenExpiresAt" DATE,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "verification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" DATE NOT NULL,
  "createdAt" DATE NOT NULL,
  "updatedAt" DATE NOT NULL
);

CREATE TABLE "passkey" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" INTEGER NOT NULL,
  "transports" TEXT,
  "createdAt" DATE,
  "aaguid" TEXT
);

CREATE TABLE "rateLimit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" BIGINT NOT NULL
);

CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX "passkey_userId_idx" ON "passkey" ("userId");
CREATE UNIQUE INDEX "passkey_credentialID_uidx" ON "passkey" ("credentialID");

CREATE TRIGGER "passkey_limit_before_insert"
BEFORE INSERT ON "passkey"
FOR EACH ROW
WHEN (
  SELECT COUNT(*) FROM "passkey" WHERE "userId" = NEW."userId"
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'PASSKEY_LIMIT_EXCEEDED');
END;

CREATE TRIGGER "installation_admin_before_insert"
BEFORE INSERT ON installation
FOR EACH ROW
WHEN NEW.admin_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW.admin_user_id)
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_USER_NOT_FOUND');
END;

CREATE TRIGGER "installation_admin_before_update"
BEFORE UPDATE OF admin_user_id ON installation
FOR EACH ROW
WHEN NEW.admin_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW.admin_user_id)
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_USER_NOT_FOUND');
END;

CREATE TRIGGER "sole_admin_before_delete"
BEFORE DELETE ON "user"
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM installation WHERE admin_user_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'SOLE_ADMIN_DELETE_FORBIDDEN');
END;

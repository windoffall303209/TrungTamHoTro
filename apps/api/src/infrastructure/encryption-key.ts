import { createHash, scrypt } from "node:crypto";

/** Cache one configured key per purpose; derive off the event loop and coalesce concurrent requests. */
export function createEncryptionKeyDeriver(salt: string): (secret: string) => Promise<Buffer> {
  let cached: { fingerprint: string; key: Promise<Buffer> } | undefined;
  return (secret: string) => {
    const fingerprint = createHash("sha256").update(secret).digest("hex");
    if (cached?.fingerprint === fingerprint) return cached.key;
    const key = new Promise<Buffer>((resolve, reject) => {
      scrypt(secret, salt, 32, (error, derived) => error ? reject(error) : resolve(derived));
    });
    cached = { fingerprint, key };
    void key.catch(() => { if (cached?.key === key) cached = undefined; });
    return key;
  };
}

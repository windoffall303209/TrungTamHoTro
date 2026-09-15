import { createHash, scrypt } from "node:crypto";

/** Lưu đệm khóa theo mục đích; dẫn xuất ngoài luồng sự kiện và gộp các yêu cầu đồng thời. */
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

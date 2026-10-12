import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(callbackScrypt);
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 14) throw new Error("Mindestens 14 Zeichen erforderlich.");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, OPTIONS);
  return `scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function validPasswordHash(encoded) {
  if (typeof encoded !== "string") return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$1") return false;
  return [16, 32].every((size, i) => {
    const value = parts[i + 4]; const bytes = Buffer.from(value, "base64");
    return bytes.length === size && bytes.toString("base64") === value;
  });
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || password.length > 4096 || !validPasswordHash(encoded)) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$1") return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = await scrypt(password, salt, 32, OPTIONS);
  return timingSafeEqual(actual, expected);
}

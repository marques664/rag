import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const FORMAT_PREFIX = 'scrypt';

function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelism },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

/**
 * Hashes a plaintext password using Node.js scrypt with a random 16-byte salt.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(
    password,
    salt,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
  );

  return [
    FORMAT_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join('$');
}

/**
 * Verifies a plaintext password against a stored scrypt hash in constant time.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6) {
    return false;
  }

  const [prefix, costRaw, blockSizeRaw, parallelismRaw, saltHex, expectedHex] =
    parts;

  if (
    prefix !== FORMAT_PREFIX ||
    !costRaw ||
    !blockSizeRaw ||
    !parallelismRaw ||
    !saltHex ||
    !expectedHex
  ) {
    return false;
  }

  const cost = Number.parseInt(costRaw, 10);
  const blockSize = Number.parseInt(blockSizeRaw, 10);
  const parallelism = Number.parseInt(parallelismRaw, 10);

  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(blockSize) ||
    !Number.isFinite(parallelism) ||
    cost <= 0 ||
    blockSize <= 0 ||
    parallelism <= 0
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(expectedHex, 'hex');
  if (salt.length === 0 || expectedKey.length !== KEY_LENGTH) {
    return false;
  }

  const actualKey = await deriveKey(
    password,
    salt,
    cost,
    blockSize,
    parallelism,
  );

  return timingSafeEqual(actualKey, expectedKey);
}

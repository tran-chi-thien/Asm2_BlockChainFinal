const fs = require('fs').promises;
const CryptoJS = require("../utils/crypto-js.min");
const keys = require("../configs/keys");

const INVENTORY_KEY_MAP = {
  A: "InventoryA",
  B: "InventoryB",
  C: "InventoryC",
  D: "InventoryD"
};

function recordToString(record) {
  const itemId = record.ItemID.trim();
  const itemQty = record.ItemQty.trim();
  const itemPrice = record.ItemPrice.trim();
  const location = record.location.trim();

  return `${itemId}, ${itemQty}, ${itemPrice}, ${location}`;
}

function modInverse(a, m) {
  // multiplicative inverse under modulo m
  let m0 = BigInt(m);
  let y = 0n, x = 1n;

  if (m0 === 1n) {
    return 0n;
  }

  while (a > 1n) {
    // q is quotient
    let q = a / m0;
    let t = m0;
    // m0 is remainder now, process same as Euclid's algorithm
    m0 = a % m0;
    a = t;
    t = y;
    // Update y and x
    y = x - q * y;
    x = t;
  }
  // Make x positive
  if (x < 0n) {
    x += BigInt(m);
  }

  return x;
}
// https://www.geeksforgeeks.org/dsa/multiplicative-inverse-under-modulo-m/

// power mod
function powMod(base, exp, mod) {
  let result = 1n;
  base %= mod;

  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    base = (base * base) % mod;
    exp /= 2n;
  }

  return result;
}

// sha 256 hash
function sha256(data) {
  return CryptoJS.SHA256(String(data)).toString(CryptoJS.enc.Hex);
}

function normalizeInventoryName(inventory) {
  const normalized = INVENTORY_KEY_MAP[String(inventory).trim()];
  return normalized;
}

// derive n, phi and dm take data from the key file to generate key 
function calculateRSAParams(inventory) {
  const invName = normalizeInventoryName(inventory);
  const keyData = keys.PART1[invName];

  const p = keyData.p;
  const q = keyData.q;
  const e = keyData.e;
  const n = p * q;
  const phi = (p - 1n) * (q - 1n);
  const d = modInverse(e, phi);

  return { p, q, e, n, phi, d };
}

// sign record hash^d mod n
function signRecord(record, inventory) {
  const plaintext = typeof record === "string" ? record : recordToString(record);
  const hash = sha256(plaintext);
  const decimalHash = BigInt(`0x${hash}`);
  const { e, n, d, p, q, phi } = calculateRSAParams(inventory);
  const signature = powMod(decimalHash, d, n);

  return {
    signature,
    hash,
    decimalHash,
    publicKey: { e, n },
    privateKey: { d, n },
    params: { p, q, e, n, phi, d }
  };
}

// verify signature sig^e mod n
function verifySignature(signature, record) {
  const plaintext = typeof record === "string" ? record : recordToString(record);
  const hash = sha256(plaintext);
  const { e, n } = calculateRSAParams(record.originNode);
  const decrypted = powMod(BigInt(signature), e, n);
  const decryptedHex = decrypted.toString(16).padStart(hash.length, "0");
  const valid = decryptedHex === hash;

  return {
    valid,
    hash,
    decryptedHex,
    publicKey: { e, n }
  };
}

// Process pending records: verify signatures and store valid full records in pending, delete old data + signature
async function processPending() {
  const inventories = ['A', 'B', 'C', 'D'];
  const results = [];

  for (const inv of inventories) {
    const pendingFile = `datas/pending${inv}.json`;

    let pending = [];
    try {
      const data = await fs.readFile(pendingFile, 'utf8');
      pending = JSON.parse(data);
    } catch (err) {
      // No pending file or empty
      continue;
    }

    const validRecords = [];
    let invalidCount = 0;
    for (const entry of pending) {
      const { valid } = verifySignature(entry.signature, entry.record);
      if (valid) {
        validRecords.push(entry.record);
      } else {
        invalidCount++;
      }
    }

    // Store valid full records in pending file
    await fs.writeFile(pendingFile, JSON.stringify(validRecords, null, 2));

    results.push({
      inventory: inv,
      verified: validRecords,
      invalid: invalidCount
    });
  }

  return results;
}

module.exports = {
  recordToString,
  modInverse,
  powMod,
  sha256,
  normalizeInventoryName,
  calculateRSAParams,
  signRecord,
  verifySignature,
  processPending
};
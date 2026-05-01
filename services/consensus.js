const fs = require('fs').promises;
const { verifySignature } = require("./rsa");

const INVENTORIES = ["A", "B", "C", "D"];

const pendingPath = (inv) => `datas/pending${inv}.json`;
const inventoryPath = (inv) => `datas/inventory${inv}.json`;

function canonicalRecordKey(record) {
  return [
    String(record.ItemID).trim(),
    String(record.ItemQty).trim(),
    String(record.ItemPrice).trim(),
    String(record.location ).trim()
  ].join("|");
}

function buildInventoryEntry(record) {
  const origin = record.originNode || record.location || "";
  return {
    original: origin,
    record,
    recordString: canonicalRecordKey(record)
  };
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return [];
    }
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function verifyAndStorePending() {
  const pendingResults = [];
  const validRecordMap = new Map();
  const cleanedPendingByInventory = {};

  for (const inv of INVENTORIES) {
    const pendingEntries = await readJsonFile(pendingPath(inv));
    const cleanedRecords = [];
    let invalidCount = 0;

    for (const entry of pendingEntries) {
      const { valid } = verifySignature(entry.signature, entry.record);
      if (valid) {
        cleanedRecords.push(entry.record);
        const key = canonicalRecordKey(entry.record);
        const summary = validRecordMap.get(key) ?? { record: entry.record, sources: new Set() };
        summary.sources.add(inv);
        validRecordMap.set(key, summary);
      } else {
        invalidCount++;
      }
    }

    cleanedPendingByInventory[inv] = cleanedRecords;
    pendingResults.push({
      inventory: inv,
      verified: cleanedRecords,
      invalid: invalidCount,
      pendingCount: cleanedRecords.length
    });

    await writeJsonFile(pendingPath(inv), cleanedRecords);
  }

  const consensusCandidates = buildConsensusCandidates(validRecordMap);
  const passedRecords = consensusCandidates.filter((candidate) => candidate.count >= 3);

  return {
    pending: pendingResults,
    candidates: consensusCandidates,
    passedRecords
  };
}

function buildConsensusCandidates(validRecordMap) {
  const candidates = [];
  for (const [recordKey, summary] of validRecordMap.entries()) {
    const sources = Array.from(summary.sources).sort();
    candidates.push({
      record: summary.record,
      recordKey,
      count: sources.length,
      sources
    });
  }
  return candidates;
}

async function readCleanedPending() {
  const cleanedPendingByInventory = {};
  for (const inv of INVENTORIES) {
    cleanedPendingByInventory[inv] = await readJsonFile(pendingPath(inv));
  }
  return cleanedPendingByInventory;
}

function comparePendingRecords(cleanedPendingByInventory) {
  const recordMap = new Map();
  const candidates = [];

  for (const inv of INVENTORIES) {
    const records = cleanedPendingByInventory[inv];
    for (const record of records) {
      const key = canonicalRecordKey(record);
      const summary = recordMap.get(key) ?? { record, sources: new Set() };
      summary.sources.add(inv);
      recordMap.set(key, summary);
    }
  }

  for (const [recordKey, summary] of recordMap.entries()) {
    const sources = Array.from(summary.sources).sort();
    candidates.push({
      record: summary.record,
      recordKey,
      count: sources.length,
      sources
    });
  }

  const passedRecords = candidates.filter((candidate) => candidate.count >= 3);
  return { candidates, passedRecords };
}

async function commitConsensus(passedRecords) {
  for (const inv of INVENTORIES) {
    const inventoryRecords = await readJsonFile(inventoryPath(inv));
    const updatedInventory = [...inventoryRecords];

    for (const passed of passedRecords) {
      const alreadyCommitted = updatedInventory.some(
        (item) => canonicalRecordKey(item.record) === passed.recordKey
      );
      if (!alreadyCommitted) {
        updatedInventory.push(buildInventoryEntry(passed.record));
      }
    }

    await writeJsonFile(inventoryPath(inv), updatedInventory);
  }

  const passedKeys = new Set(passedRecords.map((record) => record.recordKey));
  for (const inv of INVENTORIES) {
    const pendingRecords = await readJsonFile(pendingPath(inv));
    const remaining = pendingRecords.filter(
      (record) => !passedKeys.has(canonicalRecordKey(record))
    );
    await writeJsonFile(pendingPath(inv), remaining);
  }
}

async function processConsensus(stage = 'verify') {
  if (stage === 'verify') {
    const { pending, candidates, passedRecords } = await verifyAndStorePending();
    return {
      stage,
      pending,
      candidates,
      consensus: {
        status: 'verification',
        message: 'Signature verification complete. Valid records were stored in pending files.',
        canCommit: passedRecords.length > 0,
        passedRecords
      }
    };
  }

  if (stage === 'compare') {
    const cleanedPendingByInventory = await readCleanedPending();
    const { candidates, passedRecords } = comparePendingRecords(cleanedPendingByInventory);
    return {
      stage,
      pending: INVENTORIES.map((inv) => ({
        inventory: inv,
        verified: cleanedPendingByInventory[inv],
        invalid: 0,
        pendingCount: cleanedPendingByInventory[inv].length
      })),
      candidates,
      consensus: {
        status: passedRecords.length > 0 ? 'success' : 'failed',
        message: passedRecords.length > 0
          ? 'Atleast 3/4 consensus achieved. Ready to commit.'
          : 'Consensus Failed: Tampering detected. No record has 3 matching copies.',
        canCommit: passedRecords.length > 0,
        passedRecords
      }
    };
  }

  if (stage === 'commit') {
    const cleanedPendingByInventory = await readCleanedPending();
    const { candidates, passedRecords } = comparePendingRecords(cleanedPendingByInventory);
    if (passedRecords.length === 0) {
      return {
        stage,
        pending: INVENTORIES.map((inv) => ({
          inventory: inv,
          verified: cleanedPendingByInventory[inv],
          invalid: 0,
          pendingCount: cleanedPendingByInventory[inv].length
        })),
        candidates,
        consensus: {
          status: 'failed',
          message: 'Consensus Failed: Tampering detected. Inventories were not updated.',
          canCommit: false,
          passedRecords
        }
      };
    }

    await commitConsensus(passedRecords);
    return {
      stage,
      candidates,
      consensus: {
        status: 'passed',
        message: `Consensus Passed: ${passedRecords.length} record(s) committed to all inventories.`,
        passedRecords
      }
    };
  }

  throw new Error(`Unknown consensus stage: ${stage}`);
}

module.exports = {
  processConsensus
};
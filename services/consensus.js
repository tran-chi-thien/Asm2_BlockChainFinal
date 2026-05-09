const fs = require('fs').promises;

const INVENTORIES = ["A", "B", "C", "D"];

const pendingPath = (inv) => `datas/pending${inv}.json`;
const inventoryPath = (inv) => `datas/inventory${inv}.json`;

function canonicalRecordKey(record) {
  return [
    String(record.ItemID).trim(),
    String(record.ItemQty).trim(),
    String(record.ItemPrice).trim(),
    String(record.location).trim()
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
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Pending files already contain only verified records (signature checked at broadcast time).
// Stage 1 (compare): count how many inventories hold each unique record — need >= 3.
// Stage 2 (commit):  write passed records to all inventory files and clear pending.

function buildCandidates(pendingByInventory) {
  const recordMap = new Map();

  for (const inv of INVENTORIES) {
    for (const entry of pendingByInventory[inv]) {
      const record = entry.record ?? entry;
      const key = canonicalRecordKey(record);
      const summary = recordMap.get(key) ?? { record, sources: new Set() };
      summary.sources.add(inv);
      recordMap.set(key, summary);
    }
  }

  const candidates = [];
  for (const [recordKey, summary] of recordMap.entries()) {
    const sources = Array.from(summary.sources).sort();
    candidates.push({ record: summary.record, recordKey, count: sources.length, sources });
  }

  return candidates;
}

async function readAllPending() {
  const result = {};
  for (const inv of INVENTORIES) {
    result[inv] = await readJsonFile(pendingPath(inv));
  }
  return result;
}

async function commitConsensus(passedRecords) {
  for (const inv of INVENTORIES) {
    const inventoryRecords = await readJsonFile(inventoryPath(inv));
    const updated = [...inventoryRecords];

    for (const passed of passedRecords) {
      // Always append — old entries are kept as history (blockchain immutability)
      const alreadyCommitted = updated.some(
        item => canonicalRecordKey(item.record) === passed.recordKey
      );
      if (!alreadyCommitted) {
        updated.push(buildInventoryEntry(passed.record));
      }
    }

    await writeJsonFile(inventoryPath(inv), updated);
  }

  const passedKeys = new Set(passedRecords.map(r => r.recordKey));
  for (const inv of INVENTORIES) {
    const pending = await readAllPending();
    const remaining = pending[inv].filter(entry => {
      const record = entry.record ?? entry;
      return !passedKeys.has(canonicalRecordKey(record));
    });
    await writeJsonFile(pendingPath(inv), remaining);
  }
}

async function processConsensus(stage = 'compare') {
  if (stage === 'compare') {
    const pendingByInventory = await readAllPending();
    const candidates = buildCandidates(pendingByInventory);
    const passedRecords = candidates.filter(c => c.count >= 3);

    return {
      stage,
      pending: INVENTORIES.map(inv => ({
        inventory: inv,
        records: pendingByInventory[inv].map(e => e.record ?? e),
        pendingCount: pendingByInventory[inv].length
      })),
      candidates,
      consensus: {
        status: passedRecords.length > 0 ? 'success' : 'failed',
        message: passedRecords.length > 0
          ? 'At least 3/4 inventories hold the record. Ready to commit.'
          : 'Consensus failed: no record found in at least 3 inventories.',
        canCommit: passedRecords.length > 0,
        passedRecords
      }
    };
  }

  if (stage === 'commit') {
    const pendingByInventory = await readAllPending();
    const candidates = buildCandidates(pendingByInventory);
    const passedRecords = candidates.filter(c => c.count >= 3);

    if (passedRecords.length === 0) {
      return {
        stage,
        candidates,
        consensus: {
          status: 'failed',
          message: 'Consensus failed: inventories were not updated.',
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
        message: `Consensus passed: ${passedRecords.length} record(s) committed to all inventories.`,
        passedRecords
      }
    };
  }

  throw new Error(`Unknown consensus stage: ${stage}`);
}

module.exports = { processConsensus };

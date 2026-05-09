const fs = require('fs').promises;
const {
  computePKGKeyPair,
  deriveIdentitySecretKeys,
  calculateTValues,
  buildPartialSignatures,
  combinePartialSignatures
} = require('../services/multiSignature');
const { recordToString } = require('../services/rsa');

const INVENTORIES = ['A', 'B', 'C', 'D'];

function inventoryPath(inv) {
  return `datas/inventory${inv}.json`;
}

async function readInventory(inv) {
  try {
    const data = await fs.readFile(inventoryPath(inv), 'utf8');
    if (!data.trim()) {
      return [];
    }
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function chooseConsensusRecord(matches) {
  const recordMap = new Map();

  for (const match of matches) {
    const key = recordToString(match.record);
    const summary = recordMap.get(key) || { record: match.record, count: 0, sources: new Set() };
    summary.count += 1;
    summary.sources.add(match.inventory);
    recordMap.set(key, summary);
  }

  let best = null;
  for (const summary of recordMap.values()) {
    if (!best || summary.count > best.count) {
      best = summary;
    }
  }

  return best;
}

async function queryRecord(req, res) {
  const recordID = String(req.body.recordID || '').trim();
  const queryStage = String(req.body.stage || 'search');

  if (!recordID) {
    return res.render('index', {
      title: 'Express',
      step: 'form',
      message: 'Please type a Record ID to search (for example 001).'
    });
  }

  const matches = [];
  for (const inv of INVENTORIES) {
    const inventory = await readInventory(inv);
    // Collect all entries with this ItemID, then take the last one (most recently committed)
    const entriesForID = inventory.filter(
      entry => entry && entry.record && String(entry.record.ItemID).trim() === recordID
    );
    if (entriesForID.length > 0) {
      const latest = entriesForID[entriesForID.length - 1];
      matches.push({ inventory: inv, record: latest.record });
    }
  }

  if (matches.length === 0) {
    return res.render('index', {
      step: 'search',
      recordId: recordID,
      queryStage,
      record: null,
      message: `Record ID ${recordID} not found in inventories A, B, C, or D.`
    });
  }

  const bestRecord = chooseConsensusRecord(matches);
  const consensusCount = bestRecord.count;
  const consensusPassed = consensusCount >= 3;
  const pkgParams = computePKGKeyPair();
  const identitySecrets = deriveIdentitySecretKeys(pkgParams);
  const tValues = calculateTValues(pkgParams);
  const partials = buildPartialSignatures(bestRecord.record, identitySecrets, tValues, pkgParams);
  const combinedSignature = combinePartialSignatures(partials, pkgParams);
  const validSignaturesCount = partials.filter((p) => p.valid).length;
  const enough = consensusPassed;
  const message = queryStage === 'search'
    ? 'Record found. Begin the step-by-step verification demo.'
    : enough
      ? `Consensus passed with ${consensusCount} matching inventory copies.`
      : 'Access denied. Not enough matching copies to reach consensus.';

  return res.render('index', {
    step: 'search',
    recordId: recordID,
    queryStage,
    record: bestRecord.record,
    message,
    multiSig: {
      pkgParams,
      identitySecrets,
      tValues,
      partials,
      combinedSignature,
      validSignaturesCount,
      enough,
      consensus: {
        count: consensusCount,
        sources: Array.from(bestRecord.sources).sort()
      }
    }
  });
}

module.exports = {
  queryRecord
};

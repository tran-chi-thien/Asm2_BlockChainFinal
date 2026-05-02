const fs = require('fs').promises;
const {
  computePKGKeyPair,
  deriveIdentitySecretKeys,
  calculateTValues,
  buildPartialSignatures,
  combinePartialSignatures
} = require('../services/multiSignature');

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
    inventory.forEach((entry) => {
      if (entry && entry.record && String(entry.record.ItemID).trim() === recordID) {
        matches.push({ inventory: inv, record: entry.record });
      }
    });
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

  const latestMatch = matches[matches.length - 1];
  const pkgParams = computePKGKeyPair();
  const identitySecrets = deriveIdentitySecretKeys(pkgParams);
  const tValues = calculateTValues(pkgParams);
  const partials = buildPartialSignatures(recordID, identitySecrets, tValues, pkgParams);
  const combinedSignature = combinePartialSignatures(partials, pkgParams);
  const validSignaturesCount = partials.filter((p) => p.valid).length;
  const enough = validSignaturesCount >= 3;
  const message = queryStage === 'search'
    ? 'Record found. Begin the step-by-step verification demo.'
    : enough
      ? `Verification passed with ${validSignaturesCount} valid signatures.`
      : 'Access denied. Not enough valid signatures.';

  return res.render('index', {
    step: 'search',
    recordId: recordID,
    queryStage,
    record: latestMatch.record,
    message,
    multiSig: {
      pkgParams,
      identitySecrets,
      tValues,
      partials,
      combinedSignature,
      validSignaturesCount,
      enough
    }
  });
}

module.exports = {
  queryRecord
};

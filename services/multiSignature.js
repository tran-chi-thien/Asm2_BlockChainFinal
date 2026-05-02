const keys = require("../configs/keys");
const { sha256, powMod, modInverse } = require("./rsa");

function computePKGKeyPair() {
  const { p, q, e } = keys.PART2.PKG;
  const n = p * q;
  const phi = (p - 1n) * (q - 1n);
  const d = modInverse(e, phi);
  return { p, q, e, n, phi, d };
}

function deriveIdentitySecretKeys(pkgParams) {
  const secrets = {};
  for (const identityName of Object.keys(keys.IDENTITIES)) {
    const inventory = identityName.replace(/^Inventory/, "");
    const identityString = `${identityName}:${keys.IDENTITIES[identityName]}`;
    const identityHash = sha256(identityString);
    const identityHashBig = BigInt(`0x${identityHash}`);
    const secretKey = powMod(identityHashBig, pkgParams.d, pkgParams.n);
    secrets[inventory] = {
      inventory,
      identityName,
      identityString,
      identityHash,
      secretKey
    };
  }
  return secrets;
}

function calculateTValues(pkgParams) {
  const tValues = {};
  for (const randomName of Object.keys(keys.RANDOMS)) {
    const inventory = randomName.replace(/^Inventory/, "");
    const randomValue = BigInt(keys.RANDOMS[randomName]);
    tValues[inventory] = powMod(randomValue, pkgParams.e, pkgParams.n);
  }
  return tValues;
}

function verifyPartialSignature(partialSignature, requestHashBig, secretKey, randomValue, tValue, pkgParams) {
  const expected = (requestHashBig * secretKey + randomValue + tValue) % pkgParams.n;
  return expected === partialSignature;
}

function buildPartialSignatures(recordId, identitySecrets, tValues, pkgParams) {
  const requestHash = sha256(`RecordID:${recordId}`);
  const requestHashBig = BigInt(`0x${requestHash}`);
  return Object.values(identitySecrets).map((secret) => {
    const randomValue = BigInt(keys.RANDOMS[`Inventory${secret.inventory}`]);
    const tValue = tValues[secret.inventory];
    const partialSignature = (requestHashBig * secret.secretKey + randomValue + tValue) % pkgParams.n;
    const valid = verifyPartialSignature(partialSignature, requestHashBig, secret.secretKey, randomValue, tValue, pkgParams);
    return {
      inventory: secret.inventory,
      identityName: secret.identityName,
      secretKey: secret.secretKey,
      randomValue,
      tValue,
      requestHash,
      partialSignature,
      valid
    };
  });
}

function combinePartialSignatures(partials, pkgParams) {
  return partials.reduce((combined, item) => (combined + item.partialSignature) % pkgParams.n, 0n);
}

function buildMultiSignaturePackage(recordId) {
  const pkgParams = computePKGKeyPair();
  const identitySecrets = deriveIdentitySecretKeys(pkgParams);
  const tValues = calculateTValues(pkgParams);
  const partials = buildPartialSignatures(recordId, identitySecrets, tValues, pkgParams);
  const combinedSignature = combinePartialSignatures(partials, pkgParams);
  const validSignaturesCount = partials.filter((p) => p.valid).length;
  const enough = validSignaturesCount >= 3;

  return {
    pkgParams,
    identitySecrets,
    tValues,
    partials,
    combinedSignature,
    validSignaturesCount,
    enough
  };
}

module.exports = {
  computePKGKeyPair,
  deriveIdentitySecretKeys,
  calculateTValues,
  buildPartialSignatures,
  combinePartialSignatures,
  buildMultiSignaturePackage
};

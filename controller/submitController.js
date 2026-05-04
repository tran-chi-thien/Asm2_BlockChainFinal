const fs = require('fs').promises;
const { signRecord } = require("../services/rsa");
const {
  computePKGKeyPair,
  deriveIdentitySecretKeys,
  calculateTValues,
  buildPartialSignatures
} = require("../services/multiSignature");

function submitRecord(req, res) {
    const originNode = req.body.originNode;
    const record = {
        ItemID: req.body.ItemID.trim(),
        ItemQty: req.body.ItemQty.trim(),
        ItemPrice: req.body.ItemPrice.trim(),
        location: req.body.location.trim(),
        originNode
    };

    // Sign the record
    const { signature, publicKey, privateKey } = signRecord(record, originNode);

    const pkgParams = computePKGKeyPair();
    const identitySecrets = deriveIdentitySecretKeys(pkgParams);
    const tValues = calculateTValues(pkgParams);
    const partials = buildPartialSignatures(record, identitySecrets, tValues, pkgParams);

    // Broadcast to all pending files
    const inventories = ['A', 'B', 'C', 'D'];
    (async () => {
        for (const inv of inventories) {
            const pendingFile = `datas/pending${inv}.json`;
            let pending = [];
            try {
                const data = await fs.readFile(pendingFile, 'utf8');
                pending = JSON.parse(data);
            } catch (err) {
                // File doesn't exist or empty, start with empty array
            }
            const partial = partials.find((part) => part.inventory === inv);
            pending.push({
                record,
                originNode,
                originSignature: signature.toString(),
                partialSignature: partial.partialSignature.toString()
            });
            await fs.writeFile(pendingFile, JSON.stringify(pending, null, 2));
        }
        // Render demo page
        res.render('index', { step: 'demo', originNode, record, signature: signature.toString(), publicKey, privateKey });
    })().catch(err => {
        console.error(err);
        res.status(500).send('Error processing record');
    });
}

module.exports = {
    submitRecord
}
const fs = require('fs').promises;
const { signRecord, verifySignature } = require("../services/rsa");

function submitRecord(req, res) {
    const originNode = req.body.originNode;
    const record = {
        ItemID: req.body.ItemID.trim(),
        ItemQty: req.body.ItemQty.trim(),
        ItemPrice: req.body.ItemPrice.trim(),
        location: req.body.location.trim(),
        originNode
    };

    // Step 1: Proposer X signs the record  (sig = hash^d mod n)
    const { signature, hash, publicKey, privateKey } = signRecord(record, originNode);

    const inventories = ['A', 'B', 'C', 'D'];
    (async () => {
        const broadcastResults = [];

        for (const inv of inventories) {
            // Step 2: Each inventory receives {record, signature} and verifies
            //         sig^e mod n == hash  before storing in pending
            const { valid } = verifySignature(signature.toString(), record);

            if (valid) {
                const pendingFile = `datas/pending${inv}.json`;
                let pending = [];
                try {
                    const data = await fs.readFile(pendingFile, 'utf8');
                    pending = JSON.parse(data);
                } catch (err) {}
                pending.push({ record, signature: signature.toString() });
                await fs.writeFile(pendingFile, JSON.stringify(pending, null, 2));
            }

            broadcastResults.push({ inventory: inv, accepted: valid });
        }

        res.render('index', {
            step: 'demo',
            originNode,
            record,
            hash,
            signature: signature.toString(),
            publicKey,
            privateKey,
            broadcastResults
        });
    })().catch(err => {
        console.error(err);
        res.status(500).send('Error processing record');
    });
}

module.exports = { submitRecord };

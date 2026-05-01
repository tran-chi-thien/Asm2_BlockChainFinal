const fs = require('fs').promises;
const { signRecord } = require("../services/rsa");

function submitRecord(req, res) {
    const originNode = req.body.originNode;
    const record = {
        ItemID: req.body.ItemID.trim(),
        ItemQty: req.body.ItemQty.trim(),
        ItemPrice: req.body.ItemPrice.trim(),
        location: req.body.location.trim()
    };

    // Sign the record
    const { signature, publicKey, privateKey } = signRecord(record, originNode);

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
            pending.push({ record, signature: signature.toString() });
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
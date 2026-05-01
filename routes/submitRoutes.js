const express = require("express");
const { submitRecord } = require("../controller/submitController");
const { processConsensus } = require("../services/consensus");

const router = express.Router();

/* display home page */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express', step: 'form' });
});
/* submit the entered record */
router.post('/submit-record', submitRecord);
/* process pending records */
router.post('/process-pending', async (req, res) => {
  try {
    const stage = req.body.stage || 'verify';
    const results = await processConsensus(stage);
    res.render('index', { step: 'process', results });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;

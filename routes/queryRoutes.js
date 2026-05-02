const express = require("express");
const { queryRecord } = require("../controller/queryController");

const router = express.Router();

router.post('/query-record', queryRecord);

module.exports = router;

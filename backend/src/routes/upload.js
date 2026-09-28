const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { parseLogFile } = require("../services/parser");
const { computeFileHash } = require("../services/fingerprint");
const { pool } = require("../db");
const { enqueueError } = require("../queue");
const { createUploadHandler } = require("./uploadHandler");

const router = express.Router();
const uploadDir = path.resolve(__dirname, "../../uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
});

const handleUpload = createUploadHandler({
  readFile: fs.promises.readFile,
  unlink: fs.promises.unlink,
  pool,
  parseLogFile,
  computeFileHash,
  enqueueError,
});

router.post("/", upload.single("file"), handleUpload);

module.exports = router;

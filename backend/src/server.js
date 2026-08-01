// src/server.js
const express = require("express");
const cors = require("cors");

const uploadRouter = require("./routes/upload");
const dashboardRouter = require("./routes/dashboard");
const previewRouter = require("./routes/preview");
const analyzeRouter = require("./routes/analyze");
const workerStarter = require("./worker"); // if you still use it

const app = express();

// ---------- CORS ----------
const allowedOrigins = [
  "https://file-analyzer-frontend.onrender.com", // your deployed frontend
  "http://localhost:5000",
  "http://localhost:3000",
];

const corsOptions = {
  origin: (origin, cb) => {
    // allow server-to-server / curl (no origin) and our known frontends
    if (!origin || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle preflight

// ---------- Body parser ----------
app.use(express.json());

// ---------- Routes ----------
app.use("/upload", uploadRouter);
app.use("/api", dashboardRouter);
app.use("/preview", previewRouter); // POST /preview
app.use("/analyze", analyzeRouter); // POST /analyze

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});

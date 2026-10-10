require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db/db-connection")

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/auth", require("./routes/auth"));
app.use("/users", require("./routes/users"));
app.use("/plants", require("./routes/plant"));
app.use("/zones", require("./routes/zone"));
app.use("/cameras", require("./routes/camera"));
app.use("/safety-rules", require("./routes/safety-rule"));
app.use("/camera-regions", require("./routes/camera-region"));
app.use("/videos", require("./routes/video"));
app.use("/jobs", require("./routes/job"));
app.use("/evidence", require("./routes/evidence"));
app.use("/incidents", require("./routes/incident"));
app.use("/detection-events", require("./routes/detection-event"));
app.use("/audit-logs", require("./routes/audit-log"));
app.use("/escalation-rules", require("./routes/escalation-rule"));
app.use("/notifications", require("./routes/notification"));

const PORT = process.env.APP_PORT || 5000;

const { startEscalationWorker } = require("./workers/escalation-worker");

async function startServer() {
  try {
    await db.sequelize.authenticate();
    console.log("✅ Database connected");

    // Start background escalation worker (Phase 6)
    startEscalationWorker(10000);

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Database startup failed:", error);
    process.exit(1);
  }
}

startServer();
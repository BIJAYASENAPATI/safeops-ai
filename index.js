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

const PORT = process.env.APP_PORT || 5000;

async function startServer() {
  try {
    await db.sequelize.authenticate();
    console.log("✅ Database connected");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Database startup failed:", error);
    process.exit(1);
  }
}

startServer();
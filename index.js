require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./db/db-connection")

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

//Sample  Routes structure
// app.use("/institute", require("./routes/institute"));
// app.use("/student", require("./routes/studentRoutes"));

const PORT = process.env.APP_PORT || 5000;

app.listen(PORT, async () => {
  try {
    await db.sequelize.authenticate();
    console.log(`✅ Database connected`);
    console.log(`Server is running on port ${PORT}`);
  } catch (error) {
    console.error("❌ Unable to connect to DB:", error);
  }
});

const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const authenticate = require("../middleware/authenticate");
const db = require("../db/db-connection");

const EVIDENCE_DIR = path.join(__dirname, "../storage/evidence");

// GET /evidence/:filename - Protected evidence access scoped to plant permissions
router.get("/:filename", authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(EVIDENCE_DIR, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: "Evidence file not found",
        message: "Evidence file not found",
      });
    }

    // Find incident or detection event referencing this evidence
    const incident = await db.Incident.findOne({
      where: {
        [db.Sequelize.Op.or]: [
          { evidence_url: `/storage/evidence/${sanitizedFilename}` },
          { evidence_url: sanitizedFilename },
        ],
      },
      include: [{ model: db.Zone, as: "zone" }],
    });

    const event = await db.DetectionEvent.findOne({
      where: { evidence_storage_key: sanitizedFilename },
      include: [{ model: db.Zone, as: "zone" }],
    });

    const targetZone = incident?.zone || event?.zone;
    if (targetZone) {
      const isSuperAdmin = req.user.role === "super_admin";
      const isAssigned = Number(req.user.plant_id) === Number(targetZone.plant_id);

      if (!isSuperAdmin && !isAssigned) {
        return res.status(403).json({
          error: "Forbidden: access to this evidence is not permitted",
          message: "Forbidden: access to this evidence is not permitted",
        });
      }
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error("Evidence retrieval error:", error);
    return res.status(500).json({
      error: "Failed to retrieve evidence",
      message: error.message,
    });
  }
});

module.exports = router;
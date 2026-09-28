const express = require("express");
const router = express.Router();
const zoneController = require("../controllers/zone-controller");
const authenticate = require("../middleware/authenticate");

// GET /zones/:id - User assigned to zone's plant or super admin
router.get("/:id", authenticate, zoneController.getZoneById);

// PATCH /zones/:id - Super admin or admin assigned to zone's plant
router.patch("/:id", authenticate, zoneController.updateZone);

// Camera routes scoped under zone
const cameraController = require("../controllers/camera-controller");

// POST /zones/:zoneId/cameras - Super admin or admin assigned to the zone's plant
router.post("/:zoneId/cameras", authenticate, cameraController.createCamera);

// GET /zones/:zoneId/cameras - User assigned to the zone's plant or super admin
router.get("/:zoneId/cameras", authenticate, cameraController.getCamerasByZone);

module.exports = router;

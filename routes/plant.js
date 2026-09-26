const express = require("express");
const router = express.Router();
const plantController = require("../controllers/plant-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");
const authorizePlant = require("../middleware/authorize-plant");

// POST /plants - super_admin only
router.post("/", authenticate, authorizeRoles("super_admin"), plantController.createPlant);

// GET /plants - Signed-in user (super_admin sees all; other users see only assigned plant)
router.get("/", authenticate, plantController.getAllPlants);

// GET /plants/:id - Assigned user or super_admin
router.get("/:id", authenticate, authorizePlant, plantController.getPlantById);

// PATCH /plants/:id - super_admin only
router.patch("/:id", authenticate, authorizeRoles("super_admin"), plantController.updatePlant);

// Zone routes scoped under plant
const zoneController = require("../controllers/zone-controller");

// POST /plants/:plantId/zones - Super admin or admin assigned to that plant
router.post("/:plantId/zones", authenticate, zoneController.createZone);

// GET /plants/:plantId/zones - User assigned to that plant or super admin
router.get("/:plantId/zones", authenticate, zoneController.getZonesByPlant);

module.exports = router;
const express = require("express");
const router = express.Router();
const plantController = require("../controllers/plant-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");
const authorizePlant = require("../middleware/authorize-plant");

// POST /plants - super_admin or admin
router.post("/", authenticate, authorizeRoles("super_admin", "admin"), plantController.createPlant);

// GET /plants - Signed-in user (admin and super_admin see all; other users see only assigned plant)
router.get("/", authenticate, plantController.getAllPlants);

// GET /plants/:id - Assigned user, admin, or super_admin
router.get("/:id", authenticate, authorizePlant, plantController.getPlantById);

// PATCH /plants/:id - super_admin or admin
router.patch("/:id", authenticate, authorizeRoles("super_admin", "admin"), plantController.updatePlant);

// Enable/disable plant - super_admin or admin
router.patch("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), plantController.enablePlant);
router.post("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), plantController.enablePlant);
router.patch("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), plantController.disablePlant);
router.post("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), plantController.disablePlant);
router.patch("/:id/status", authenticate, authorizeRoles("super_admin", "admin"), plantController.updatePlantStatus);

// DELETE /plants/:id - super_admin or admin (deactivate plant)
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), plantController.deletePlant);

// Zone routes scoped under plant
const zoneController = require("../controllers/zone-controller");

// POST /plants/:plantId/zones - Super admin or admin assigned to that plant
router.post("/:plantId/zones", authenticate, authorizeRoles("super_admin", "admin"), zoneController.createZone);

// GET /plants/:plantId/zones - User assigned to that plant or super admin
router.get("/:plantId/zones", authenticate, zoneController.getZonesByPlant);

module.exports = router;
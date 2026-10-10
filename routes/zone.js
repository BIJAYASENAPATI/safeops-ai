const express = require("express");
const router = express.Router();
const zoneController = require("../controllers/zone-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

// GET /zones - List zones (admin/super_admin sees all; others see assigned plant)
router.get("/", authenticate, zoneController.listZones);

// POST /zones - Super admin or admin creates zone under any plant
router.post("/", authenticate, authorizeRoles("super_admin", "admin"), zoneController.createZone);

// GET /zones/:id - User assigned to zone's plant, admin, or super admin
router.get("/:id", authenticate, zoneController.getZoneById);

// Enable/disable zone - Super admin or admin assigned to zone's plant, not operator
router.patch("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), zoneController.enableZone);
router.post("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), zoneController.enableZone);
router.patch("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), zoneController.disableZone);
router.post("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), zoneController.disableZone);
router.patch("/:id/status", authenticate, authorizeRoles("super_admin", "admin"), zoneController.updateZoneStatus);

// PATCH /zones/:id - Super admin or admin assigned to zone's plant
router.patch("/:id", authenticate, authorizeRoles("super_admin", "admin"), zoneController.updateZone);

// DELETE /zones/:id - Super admin or admin assigned to zone's plant (deactivates zone)
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), zoneController.deleteZone);

// Camera routes scoped under zone
const cameraController = require("../controllers/camera-controller");

// POST /zones/:zoneId/cameras - Super admin or admin assigned to the zone's plant
router.post("/:zoneId/cameras", authenticate, authorizeRoles("super_admin", "admin"), cameraController.createCamera);

// GET /zones/:zoneId/cameras - User assigned to the zone's plant or super admin
router.get("/:zoneId/cameras", authenticate, cameraController.getCamerasByZone);

// Safety rule routes scoped under zone
const safetyRuleController = require("../controllers/safety-rule-controller");

// POST /zones/:zoneId/safety-rules - Super admin or admin assigned to the zone's plant
router.post("/:zoneId/safety-rules", authenticate, authorizeRoles("super_admin", "admin"), safetyRuleController.createSafetyRule);

// GET /zones/:zoneId/safety-rules - User assigned to the zone's plant or super admin
router.get("/:zoneId/safety-rules", authenticate, safetyRuleController.getSafetyRulesByZone);

// Escalation rule routes scoped under zone
const escalationRuleController = require("../controllers/escalation-rule-controller");

// POST /zones/:zoneId/escalation-rules - Super admin or admin assigned to the zone's plant
router.post("/:zoneId/escalation-rules", authenticate, authorizeRoles("super_admin", "admin"), escalationRuleController.createEscalationRule);

// GET /zones/:zoneId/escalation-rules - User assigned to the zone's plant or super admin
router.get("/:zoneId/escalation-rules", authenticate, escalationRuleController.getEscalationRulesByZone);

module.exports = router;
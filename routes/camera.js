const express = require("express");
const router = express.Router();
const cameraController = require("../controllers/camera-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

// GET /cameras/:id - User assigned to camera's zone's plant or super admin
router.get("/:id", authenticate, cameraController.getCameraById);

// Enable/disable camera - Super admin or admin assigned to that plant, not operator
router.patch("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), cameraController.enableCamera);
router.post("/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), cameraController.enableCamera);
router.patch("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), cameraController.disableCamera);
router.post("/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), cameraController.disableCamera);
router.patch("/:id/status", authenticate, authorizeRoles("super_admin", "admin"), cameraController.updateCameraStatus);

// PATCH /cameras/:id - Super admin or admin assigned to that plant
router.patch("/:id", authenticate, authorizeRoles("super_admin", "admin"), cameraController.updateCamera);

// DELETE /cameras/:id - Super admin or admin assigned to that plant (disables camera)
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), cameraController.deleteCamera);

module.exports = router;
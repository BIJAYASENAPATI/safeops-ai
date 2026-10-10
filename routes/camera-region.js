const express = require("express");
const router = express.Router();
const cameraRegionController = require("../controllers/camera-region-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

// GET /camera-regions - Paginated list of camera regions with plant scoping & filters
router.get("/", authenticate, cameraRegionController.listCameraRegions);

// GET /camera-regions/:id - User assigned to camera's plant or super admin
router.get("/:id", authenticate, cameraRegionController.getCameraRegionById);

// PATCH /camera-regions/:id - Super admin or admin assigned to that plant
router.patch("/:id", authenticate, authorizeRoles("super_admin", "admin"), cameraRegionController.updateCameraRegion);

// DELETE /camera-regions/:id - Super admin or admin assigned to that plant (disables region)
router.delete("/:id", authenticate, ("super_admin", "admin"), cameraRegionController.deleteCameraRegion);
authorizeRoles
module.exports = router;
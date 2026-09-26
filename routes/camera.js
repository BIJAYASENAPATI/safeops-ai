const express = require("express");
const router = express.Router();
const cameraController = require("../controllers/camera-controller");
const authenticate = require("../middleware/authenticate");

// GET /cameras/:id - User assigned to camera's zone's plant or super admin
router.get("/:id", authenticate, cameraController.getCameraById);

// PATCH /cameras/:id - Super admin or admin assigned to that plant
router.patch("/:id", authenticate, cameraController.updateCamera);

module.exports = router;
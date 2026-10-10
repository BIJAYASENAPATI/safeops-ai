const express = require("express");
const router = express.Router();
const detectionEventController = require("../controllers/detection-event-controller");
const authenticate = require("../middleware/authenticate");

// GET /detection-events - Paginated list of detection events with plant scoping & filters
router.get("/", authenticate, detectionEventController.listDetectionEvents);

// GET /detection-events/:id - Retrieve detection event by ID
router.get("/:id", authenticate, detectionEventController.getDetectionEventById);

// DELETE /detection-events/:id - Delete detection event (super_admin or plant admin)
router.delete("/:id", authenticate, detectionEventController.deleteDetectionEvent);

module.exports = router;
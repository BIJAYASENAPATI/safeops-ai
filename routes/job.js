const express = require("express");
const router = express.Router();
const processingJobController = require("../controllers/processing-job-controller");
const authenticate = require("../middleware/authenticate");

// GET /jobs - Paginated list of processing jobs with plant scoping & filters
router.get("/", authenticate, processingJobController.listProcessingJobs);

// GET /jobs/:id - Retrieve processing job details and results
router.get("/:id", authenticate, processingJobController.getJobById);

// DELETE /jobs/:id - Cancel or delete processing job (super_admin or plant admin)
router.delete("/:id", authenticate, processingJobController.deleteProcessingJob);

// GET /jobs/:id/detection-events - Retrieve detection events for a job
router.get("/:id/detection-events", authenticate, processingJobController.getJobDetectionEvents);

module.exports = router;
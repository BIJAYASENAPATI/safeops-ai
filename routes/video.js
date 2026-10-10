const express = require("express");
const router = express.Router();
const videoSourceController = require("../controllers/video-source-controller");
const processingJobController = require("../controllers/processing-job-controller");
const authenticate = require("../middleware/authenticate");

// GET /videos - Paginated list of videos with plant scoping & filters
router.get("/", authenticate, videoSourceController.listVideos);

// GET /videos/:id - Retrieve video details
router.get("/:id", authenticate, videoSourceController.getVideoById);

// DELETE /videos/:id - Delete video source (admin, super_admin, or uploader)
router.delete("/:id", authenticate, videoSourceController.deleteVideo);

// POST /videos/:videoId/jobs - Trigger video processing job
router.post("/:videoId/jobs", authenticate, processingJobController.createProcessingJob);

// GET /videos/:videoId/jobs - List processing jobs for a video
router.get("/:videoId/jobs", authenticate, processingJobController.getJobsByVideo);

module.exports = router;
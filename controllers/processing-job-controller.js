const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");
const { processVideoJob } = require("../workers/video-processor");

// POST /videos/:videoId/jobs
// Access: user assigned to video's plant or super_admin
const createProcessingJob = async (req, res) => {
  try {
    const { videoId } = req.params;

    // 1. Load video with camera, zone, plant
    const video = await db.VideoSource.findByPk(videoId, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [
            {
              model: db.Zone,
              as: "zone",
              include: [{ model: db.Plant, as: "plant" }],
            },
          ],
        },
      ],
    });

    if (!video) {
      return res.status(404).json({
        error: "Video source not found",
        message: `Video with ID ${videoId} not found`,
      });
    }

    const camera = video.camera;
    const zone = camera?.zone;
    const plant = zone?.plant;

    // 2. Permission check
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      plant && Number(req.user.plant_id) === Number(plant.id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have permission to trigger jobs for this video",
        message: "Forbidden: you do not have permission to trigger jobs for this video",
      });
    }

    // 3. Availability checks
    if (video.status === "deleted") {
      return res.status(400).json({
        error: "Source video has been deleted after processing. Please upload a new video to reprocess.",
        message: "Source video has been deleted after processing. Please upload a new video to reprocess.",
      });
    }

    if (video.status !== "ready") {
      return res.status(400).json({
        error: `Video is not ready for processing (current status: ${video.status})`,
        message: `Video is not ready for processing (current status: ${video.status})`,
      });
    }

    if (!camera || camera.is_active === false) {
      return res.status(400).json({
        error: "Camera is inactive or unavailable",
        message: "Camera is inactive or unavailable",
      });
    }

    if (!zone || zone.status !== "active") {
      return res.status(400).json({
        error: "Zone is inactive or unavailable",
        message: "Zone is inactive or unavailable",
      });
    }

    if (!plant || plant.status !== "active") {
      return res.status(400).json({
        error: "Plant is inactive or unavailable",
        message: "Plant is inactive or unavailable",
      });
    }

    // 4. Check applicable safety rules exist
    const activeRules = await db.ZoneSafetyRule.findAll({
      where: { zone_id: zone.id, is_active: true },
    });

    if (!activeRules || activeRules.length === 0) {
      return res.status(400).json({
        error: "No active safety rules configured for this zone",
        message: "No active safety rules configured for this zone",
      });
    }

    // 5. Prevent duplicate active jobs for the same video
    const existingActiveJob = await db.ProcessingJob.findOne({
      where: {
        video_source_id: video.id,
        status: { [Op.in]: ["queued", "processing"] },
      },
    });

    if (existingActiveJob) {
      return res.status(409).json({
        error: "A processing job is already active for this video",
        message: `Job ${existingActiveJob.id} is currently ${existingActiveJob.status}`,
        active_job_id: existingActiveJob.id,
      });
    }

    // 6. Snapshot rules and create job
    const ruleSnapshot = activeRules.map((r) => r.toJSON());

    const job = await db.ProcessingJob.create({
      video_source_id: video.id,
      requested_by: req.user.id,
      status: "queued",
      progress_percent: 0,
      model_version: "safeops-det-v1.0",
      rule_snapshot: ruleSnapshot,
    });

    // 7. Trigger background worker asynchronously
    setImmediate(() => {
      processVideoJob(job.id).catch((err) =>
        console.error(`Background worker error for job ${job.id}:`, err)
      );
    });

    // 8. Return 202 Accepted
    return res.status(202).json({
      message: "Processing job queued successfully",
      job_id: job.id,
      ...job.toJSON(),
    });
  } catch (error) {
    console.error("Create processing job error:", error);
    return res.status(500).json({
      error: "Failed to create processing job",
      message: error.message,
    });
  }
};

// GET /jobs/:id
// Access: user assigned to video's plant or super_admin
const getJobById = async (req, res) => {
  try {
    const { id } = req.params;

    const job = await db.ProcessingJob.findByPk(id, {
      include: [
        {
          model: db.VideoSource,
          as: "video_source",
          include: [
            {
              model: db.Camera,
              as: "camera",
              include: [{ model: db.Zone, as: "zone" }],
            },
          ],
        },
        { model: db.User, as: "requester", attributes: ["id", "name", "email", "role"] },
        { model: db.DetectionEvent, as: "events" },
      ],
    });

    if (!job) {
      return res.status(404).json({
        error: "Processing job not found",
        message: `Job with ID ${id} not found`,
      });
    }

    const camera = job.video_source?.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera?.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this processing job",
        message: "Forbidden: you do not have access to this processing job",
      });
    }

    return res.status(200).json(job);
  } catch (error) {
    console.error("Get job by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve processing job",
      message: error.message,
    });
  }
};

// GET /videos/:videoId/jobs
// Access: user assigned to video's plant or super_admin
const getJobsByVideo = async (req, res) => {
  try {
    const { videoId } = req.params;

    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Video & permission check
    const video = await db.VideoSource.findByPk(videoId, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [{ model: db.Zone, as: "zone" }],
        },
      ],
    });

    if (!video) {
      return res.status(404).json({
        error: "Video source not found",
        message: `Video with ID ${videoId} not found`,
      });
    }

    const camera = video.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera?.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this video's jobs",
        message: "Forbidden: you do not have access to this video's jobs",
      });
    }

    // 3. Query
    const whereClause = { video_source_id: Number(videoId) };
    if (req.query.status) {
      whereClause.status = req.query.status;
    }

    const { count, rows } = await db.ProcessingJob.findAndCountAll({
      where: whereClause,
      include: [
        { model: db.User, as: "requester", attributes: ["id", "name", "email", "role"] },
      ],
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get jobs by video error:", error);
    return res.status(500).json({
      error: "Failed to retrieve video jobs",
      message: error.message,
    });
  }
};

// GET /jobs/:id/detection-events
// Access: user assigned to video's plant or super_admin
const getJobDetectionEvents = async (req, res) => {
  try {
    const jobId = req.params.jobId || req.params.id;

    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Job and permission check
    const job = await db.ProcessingJob.findByPk(jobId, {
      include: [
        {
          model: db.VideoSource,
          as: "video_source",
          include: [
            {
              model: db.Camera,
              as: "camera",
              include: [{ model: db.Zone, as: "zone" }],
            },
          ],
        },
      ],
    });

    if (!job) {
      return res.status(404).json({
        error: "Processing job not found",
        message: `Job with ID ${jobId} not found`,
      });
    }

    const camera = job.video_source?.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera?.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this job's detection events",
        message: "Forbidden: you do not have access to this job's detection events",
      });
    }

    // 3. Filters
    const whereClause = { processing_job_id: Number(jobId) };
    if (req.query.verification_status) {
      whereClause.verification_status = req.query.verification_status;
    }
    if (req.query.event_type) {
      whereClause.event_type = req.query.event_type;
    }

    // 4. Query
    const { count, rows } = await db.DetectionEvent.findAndCountAll({
      where: whereClause,
      include: [
        { model: db.ZoneSafetyRule, as: "safety_rule" },
        { model: db.CameraRegion, as: "region" },
        { model: db.Incident, as: "incident" },
      ],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get job detection events error:", error);
    return res.status(500).json({
      error: "Failed to retrieve detection events",
      message: error.message,
    });
  }
};

// GET /jobs
// Access: super_admin or user assigned to job's plant
const listProcessingJobs = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error });
    }
    const { page, limit, offset } = pagination;

    const isSuperAdmin = req.user.role === "super_admin";
    const userPlantId = req.user.plant_id;

    const zoneWhere = {};
    if (!isSuperAdmin) {
      if (!userPlantId) {
        return res.status(403).json({
          error: "Forbidden: user is not assigned to any plant",
          message: "Forbidden: user is not assigned to any plant",
        });
      }
      zoneWhere.plant_id = Number(userPlantId);
    } else if (req.query.plant_id) {
      zoneWhere.plant_id = Number(req.query.plant_id);
    }

    const whereClause = {};
    if (req.query.video_source_id) {
      whereClause.video_source_id = Number(req.query.video_source_id);
    }
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.requested_by) {
      whereClause.requested_by = Number(req.query.requested_by);
    }

    const { count, rows } = await db.ProcessingJob.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.VideoSource,
          as: "video_source",
          include: [
            {
              model: db.Camera,
              as: "camera",
              include: [
                {
                  model: db.Zone,
                  as: "zone",
                  where: Object.keys(zoneWhere).length > 0 ? zoneWhere : undefined,
                  include: [{ model: db.Plant, as: "plant" }],
                },
              ],
            },
          ],
        },
        { model: db.User, as: "requester", attributes: ["id", "name", "email", "role"] },
      ],
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List processing jobs error:", error);
    return res.status(500).json({
      error: "Failed to retrieve processing jobs",
      message: error.message,
    });
  }
};

// DELETE /jobs/:id
// Access: super_admin or admin assigned to job's plant
const deleteProcessingJob = async (req, res) => {
  try {
    const { id } = req.params;

    const job = await db.ProcessingJob.findByPk(id, {
      include: [
        {
          model: db.VideoSource,
          as: "video_source",
          include: [
            {
              model: db.Camera,
              as: "camera",
              include: [{ model: db.Zone, as: "zone" }],
            },
          ],
        },
      ],
    });

    if (!job) {
      return res.status(404).json({ error: "Processing job not found", message: `Job with ID ${id} not found`, });
    }

    const camera = job.video_source?.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera?.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can delete processing jobs",
        message: "Forbidden: only super_admin or admin assigned to this plant can delete processing jobs",
      });
    }

    const force = req.query.force === "true" || req.query.permanent === "true";
    if (force) {
      await job.destroy();
      return res.status(200).json({
        message: "Processing job deleted permanently",
        id: Number(id),
      });
    }

    // Cancel job
    await job.update({ status: "failed", error_message: "Job cancelled by administrator", });

    return res.status(200).json({
      message: "Processing job cancelled successfully",
      ...job.toJSON(),
      job,
    });
  } catch (error) {
    console.error("Delete processing job error:", error);
    return res.status(500).json({ error: "Failed to delete processing job", message: error.message, });
  }
};

module.exports = { createProcessingJob, listProcessingJobs, getJobById, getJobsByVideo, getJobDetectionEvents, deleteProcessingJob, };
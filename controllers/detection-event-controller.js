const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

// GET /detection-events
// Access: super_admin or user assigned to that plant
const listDetectionEvents = async (req, res) => {
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
    if (req.query.job_id || req.query.processing_job_id) {
      whereClause.processing_job_id = Number(req.query.job_id || req.query.processing_job_id);
    }
    if (req.query.incident_id) {
      whereClause.incident_id = Number(req.query.incident_id);
    }
    if (req.query.event_type) {
      whereClause.event_type = req.query.event_type;
    }
    if (req.query.verification_status) {
      whereClause.verification_status = req.query.verification_status;
    }

    const { count, rows } = await db.DetectionEvent.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.ProcessingJob,
          as: "job",
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
          ],
        },
        { model: db.ZoneSafetyRule, as: "safety_rule" },
        { model: db.CameraRegion, as: "region" },
        { model: db.Incident, as: "incident" },
      ],
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List detection events error:", error);
    return res.status(500).json({ error: "Failed to retrieve detection events", message: error.message, });
  }
};

// GET /detection-events/:id
// Access: user assigned to plant or super_admin
const getDetectionEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await db.DetectionEvent.findByPk(id, {
      include: [
        {
          model: db.ProcessingJob,
          as: "job",
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
                      include: [{ model: db.Plant, as: "plant" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { model: db.ZoneSafetyRule, as: "safety_rule" },
        { model: db.CameraRegion, as: "region" },
        { model: db.Incident, as: "incident" },
      ],
    });

    if (!event) {
      return res.status(404).json({
        error: "Detection event not found",
        message: `Detection event with ID ${id} not found`,
      });
    }

    const plantId = event.job?.video_source?.camera?.zone?.plant_id;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = plantId && Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this detection event",
        message: "Forbidden: you do not have access to this detection event",
      });
    }

    return res.status(200).json(event);
  } catch (error) {
    console.error("Get detection event by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve detection event",
      message: error.message,
    });
  }
};

// DELETE /detection-events/:id
// Access: super_admin or admin assigned to plant
const deleteDetectionEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const event = await db.DetectionEvent.findByPk(id, {
      include: [
        {
          model: db.ProcessingJob,
          as: "job",
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
        },
      ],
    });

    if (!event) {
      return res.status(404).json({
        error: "Detection event not found",
        message: `Detection event with ID ${id} not found`,
      });
    }

    const plantId = event.job?.video_source?.camera?.zone?.plant_id;
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      plantId &&
      Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can delete detection events",
        message: "Forbidden: only super_admin or admin assigned to this plant can delete detection events",
      });
    }

    await event.destroy();

    return res.status(200).json({ message: "Detection event deleted successfully", id: Number(id), });
  } catch (error) {
    console.error("Delete detection event error:", error);
    return res.status(500).json({ error: "Failed to delete detection event", message: error.message, });
  }
};

module.exports = { listDetectionEvents, getDetectionEventById, deleteDetectionEvent, };
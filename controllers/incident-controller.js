const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

const ALLOWED_STATUSES = ["open", "acknowledged", "escalated", "resolved", "false_positive"];
const ALLOWED_SEVERITIES = ["low", "medium", "high", "critical"];

// Shared atomic action execution service
async function performIncidentAction({ incidentId, actionType, user, payload = {} }) {
  return await db.sequelize.transaction(async (t) => {
    // 1. Load and lock incident row
    const incident = await db.Incident.findByPk(incidentId, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
        {
          model: db.Camera,
          as: "camera",
        },
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!incident) {
      return {
        status: 404,
        body: {
          error: "Incident not found",
          message: `Incident with ID ${incidentId} not found`,
        },
      };
    }

    // 2. Check plant access
    const isSuperAdmin = user.role === "super_admin";
    const plantId = incident.zone?.plant_id;
    const isSamePlant = plantId && Number(user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isSamePlant) {
      return {
        status: 403,
        body: {
          error: "Forbidden: you do not have permission to modify incidents for this plant",
          message: "Forbidden: you do not have permission to modify incidents for this plant",
        },
      };
    }

    const oldStatus = incident.status;

    // 3. Action-specific validation and execution
    if (actionType === "acknowledge") {
      // Allowed current status: open, escalated
      if (incident.status === "acknowledged") {
        return {
          status: 409,
          body: {
            error: "Conflict: Incident is already acknowledged",
            message: "Incident is already acknowledged",
          },
        };
      }

      if (incident.status !== "open" && incident.status !== "escalated") {
        return {
          status: 409,
          body: {
            error: `Conflict: Cannot acknowledge incident in '${incident.status}' status`,
            message: `Cannot acknowledge incident in '${incident.status}' status`,
          },
        };
      }

      // For operator, strictly assign to self
      const assignedOperatorId =
        user.role === "operator" || !incident.assigned_operator_id
          ? user.id
          : incident.assigned_operator_id;

      await incident.update(
        {
          status: "acknowledged",
          assigned_operator_id: assignedOperatorId,
          acknowledged_at: new Date(),
        },
        { transaction: t }
      );


      // Insert audit entry
      await db.AuditLogEntry.create(
        {
          incident_id: incident.id,
          actor_id: user.id,
          action: "acknowledged",
          metadata: {
            old_status: oldStatus,
            new_status: "acknowledged",
            assigned_operator_id: assignedOperatorId,
          },
        },
        { transaction: t }
      );

      return {
        status: 200,
        body: {
          message: "Incident acknowledged successfully",
          incident: incident.toJSON(),
        },
      };
    } else if (actionType === "resolve") {
      // Required nonempty resolution notes
      const notes = payload.resolution_notes;
      if (!notes || typeof notes !== "string" || !notes.trim()) {
        return {
          status: 400,
          body: {
            error: "resolution_notes is required and cannot be empty",
            message: "resolution_notes is required and cannot be empty",
          },
        };
      }

      // Role check: operators can only resolve incidents assigned to them
      if (user.role === "operator" && Number(incident.assigned_operator_id) !== Number(user.id)) {
        return {
          status: 403,
          body: {
            error: "Forbidden: Operators can only resolve incidents assigned to them",
            message: "Forbidden: Operators can only resolve incidents assigned to them",
          },
        };
      }

      // Allowed current status: acknowledged only
      if (incident.status !== "acknowledged") {
        return {
          status: 409,
          body: {
            error: `Conflict: Cannot resolve incident with status '${incident.status}'. Incident must be in 'acknowledged' status.`,
            message: `Cannot resolve incident with status '${incident.status}'`,
          },
        };
      }

      await incident.update(
        {
          status: "resolved",
          resolved_at: new Date(),
          resolution_notes: notes.trim(),
        },
        { transaction: t }
      );

      if (payload._fail_audit) {
        throw new Error("Simulated audit log insertion failure");
      }

      await db.AuditLogEntry.create(
        {
          incident_id: incident.id,
          actor_id: user.id,
          action: "resolved",
          metadata: {
            old_status: oldStatus,
            new_status: "resolved",
            resolution_notes: notes.trim(),
          },
        },
        { transaction: t }
      );

      return {
        status: 200,
        body: {
          message: "Incident resolved successfully",
          incident: incident.toJSON(),
        },
      };
    } else if (actionType === "dismiss") {
      // Required nonempty dismissal reason
      const reason = payload.dismissal_reason;
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        return {
          status: 400,
          body: {
            error: "dismissal_reason is required and cannot be empty",
            message: "dismissal_reason is required and cannot be empty",
          },
        };
      }

      // Role check: operators can only dismiss incidents assigned to them
      if (user.role === "operator" && Number(incident.assigned_operator_id) !== Number(user.id)) {
        return {
          status: 403,
          body: {
            error: "Forbidden: Operators can only dismiss incidents assigned to them",
            message: "Forbidden: Operators can only dismiss incidents assigned to them",
          },
        };
      }

      // Allowed current status: open, acknowledged, escalated
      if (incident.status === "resolved" || incident.status === "false_positive") {
        return {
          status: 409,
          body: {
            error: `Conflict: Cannot dismiss incident with terminal status '${incident.status}'`,
            message: `Cannot dismiss incident with terminal status '${incident.status}'`,
          },
        };
      }

      await incident.update(
        {
          status: "false_positive",
          dismissed_at: new Date(),
          dismissal_reason: reason.trim(),
        },
        { transaction: t }
      );

      if (payload._fail_audit) {
        throw new Error("Simulated audit log insertion failure");
      }

      await db.AuditLogEntry.create(
        {
          incident_id: incident.id,
          actor_id: user.id,
          action: "dismissed",
          metadata: {
            old_status: oldStatus,
            new_status: "false_positive",
            dismissal_reason: reason.trim(),
          },
        },
        { transaction: t }
      );

      return {
        status: 200,
        body: {
          message: "Incident dismissed as false positive successfully",
          incident: incident.toJSON(),
        },
      };
    } else {
      return {
        status: 400,
        body: {
          error: "Invalid action",
          message: `Action '${actionType}' is not supported`,
        },
      };
    }
  });
}

// GET /incidents
// Access: super_admin (all plants) or own plant
const getIncidents = async (req, res) => {
  try {
    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Validate filter parameters
    const whereClause = {};

    if (req.query.status) {
      if (!ALLOWED_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          error: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(", ")}`,
          message: `Invalid status. Allowed values: ${ALLOWED_STATUSES.join(", ")}`,
        });
      }
      whereClause.status = req.query.status;
    }

    if (req.query.severity) {
      if (!ALLOWED_SEVERITIES.includes(req.query.severity)) {
        return res.status(400).json({
          error: `Invalid severity. Allowed values: ${ALLOWED_SEVERITIES.join(", ")}`,
          message: `Invalid severity. Allowed values: ${ALLOWED_SEVERITIES.join(", ")}`,
        });
      }
      whereClause.severity = req.query.severity;
    }

    if (req.query.processing_job_id) {
      whereClause.processing_job_id = Number(req.query.processing_job_id);
    }

    if (req.query.zone_id) {
      whereClause.zone_id = Number(req.query.zone_id);
    }

    if (req.query.camera_id) {
      whereClause.camera_id = Number(req.query.camera_id);
    }

    // Date range filtering on created_at
    if (req.query.date_from || req.query.date_to) {
      const dateFilter = {};
      if (req.query.date_from) {
        const dFrom = new Date(req.query.date_from);
        if (isNaN(dFrom.getTime())) {
          return res.status(400).json({
            error: "date_from must be a valid ISO date string",
            message: "date_from must be a valid ISO date string",
          });
        }
        dateFilter[Op.gte] = dFrom;
      }
      if (req.query.date_to) {
        const dTo = new Date(req.query.date_to);
        if (isNaN(dTo.getTime())) {
          return res.status(400).json({
            error: "date_to must be a valid ISO date string",
            message: "date_to must be a valid ISO date string",
          });
        }
        dateFilter[Op.lt] = dTo;
      }
      whereClause.created_at = dateFilter;
    }

    // 3. Plant isolation
    const isSuperAdmin = req.user.role === "super_admin";
    let effectivePlantId = null;

    if (!isSuperAdmin) {
      effectivePlantId = req.user.plant_id;
    } else if (req.query.plant_id) {
      effectivePlantId = Number(req.query.plant_id);
    }

    const zoneInclude = {
      model: db.Zone,
      as: "zone",
      include: [{ model: db.Plant, as: "plant" }],
    };

    if (effectivePlantId) {
      zoneInclude.where = { plant_id: effectivePlantId };
    }

    // 4. Query
    const { count, rows } = await db.Incident.findAndCountAll({
      where: whereClause,
      include: [
        zoneInclude,
        { model: db.Camera, as: "camera" },
        { model: db.ProcessingJob, as: "processing_job" },
        { model: db.User, as: "assigned_operator", attributes: ["id", "name", "email", "role"] },
        { model: db.DetectionEvent, as: "detection_events" },
      ],
      limit,
      offset,
      order: [["created_at", "DESC"], ["id", "DESC"]],
      distinct: true,
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get incidents error:", error);
    return res.status(500).json({
      error: "Failed to retrieve incidents",
      message: error.message,
    });
  }
};

// GET /incidents/:id
// Access: super_admin or user assigned to the incident's plant
const getIncidentById = async (req, res) => {
  try {
    const { id } = req.params;

    const incident = await db.Incident.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
        { model: db.Camera, as: "camera" },
        { model: db.ProcessingJob, as: "processing_job" },
        { model: db.User, as: "assigned_operator", attributes: ["id", "name", "email", "role"] },
        { model: db.DetectionEvent, as: "detection_events" },
      ],
    });

    if (!incident) {
      return res.status(404).json({
        error: "Incident not found",
        message: `Incident with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      incident.zone && Number(req.user.plant_id) === Number(incident.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this incident",
        message: "Forbidden: you do not have access to this incident",
      });
    }

    return res.status(200).json(incident);
  } catch (error) {
    console.error("Get incident by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve incident",
      message: error.message,
    });
  }
};

// POST /incidents/:id/acknowledge
const acknowledgeIncident = async (req, res) => {
  try {
    const result = await performIncidentAction({
      incidentId: req.params.id,
      actionType: "acknowledge",
      user: req.user,
      payload: req.body,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Acknowledge incident error:", error);
    return res.status(500).json({
      error: "Failed to acknowledge incident",
      message: error.message,
    });
  }
};

// POST /incidents/:id/resolve
const resolveIncident = async (req, res) => {
  try {
    const result = await performIncidentAction({
      incidentId: req.params.id,
      actionType: "resolve",
      user: req.user,
      payload: req.body,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Resolve incident error:", error);
    return res.status(500).json({
      error: "Failed to resolve incident",
      message: error.message,
    });
  }
};

// POST /incidents/:id/dismiss
const dismissIncident = async (req, res) => {
  try {
    const result = await performIncidentAction({
      incidentId: req.params.id,
      actionType: "dismiss",
      user: req.user,
      payload: req.body,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Dismiss incident error:", error);
    return res.status(500).json({
      error: "Failed to dismiss incident",
      message: error.message,
    });
  }
};

// GET /incidents/:id/audit-log
// Access: super_admin or user assigned to the incident's plant
const getIncidentAuditLog = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Incident & Plant permission check
    const incident = await db.Incident.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!incident) {
      return res.status(404).json({
        error: "Incident not found",
        message: `Incident with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      incident.zone && Number(req.user.plant_id) === Number(incident.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this incident's audit log",
        message: "Forbidden: you do not have access to this incident's audit log",
      });
    }

    // 3. Query audit entries
    const { count, rows } = await db.AuditLogEntry.findAndCountAll({
      where: { incident_id: Number(id) },
      include: [
        {
          model: db.User,
          as: "actor",
          attributes: ["id", "name", "email", "role"],
        },
      ],
      limit,
      offset,
      order: [
        ["created_at", "ASC"],
        ["id", "ASC"],
      ],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get incident audit log error:", error);
    return res.status(500).json({
      error: "Failed to retrieve incident audit log",
      message: error.message,
    });
  }
};

// PATCH /incidents/:id - Update incident metadata (e.g. severity)
// Access: super_admin or admin/manager of incident's plant
const updateIncident = async (req, res) => {
  try {
    const { id } = req.params;

    const incident = await db.Incident.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
      ],
    });

    if (!incident) {
      return res.status(404).json({
        error: "Incident not found",
        message: `Incident with ID ${id} not found`,
      });
    }

    const plantId = incident.zone?.plant_id;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = plantId && Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have permission to update this incident",
        message: "Forbidden: you do not have permission to update this incident",
      });
    }

    const updates = {};
    if (req.body.severity) {
      if (!ALLOWED_SEVERITIES.includes(req.body.severity)) {
        return res.status(400).json({
          error: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
          message: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
        });
      }
      updates.severity = req.body.severity;
    }

    if (req.body.resolution_notes !== undefined && ["acknowledged", "resolved"].includes(incident.status)) {
      updates.resolution_notes = req.body.resolution_notes;
    }

    if (Object.keys(updates).length > 0) {
      await incident.update(updates);
    }

    return res.status(200).json({
      message: "Incident updated successfully",
      incident: incident.toJSON(),
      ...incident.toJSON(),
    });
  } catch (error) {
    console.error("Update incident error:", error);
    return res.status(500).json({
      error: "Failed to update incident",
      message: error.message,
    });
  }
};

// DELETE /incidents/:id - Delete incident
// Access: super_admin or admin assigned to incident's plant
const deleteIncident = async (req, res) => {
  try {
    const { id } = req.params;

    const incident = await db.Incident.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
      ],
    });

    if (!incident) {
      return res.status(404).json({
        error: "Incident not found",
        message: `Incident with ID ${id} not found`,
      });
    }

    const plantId = incident.zone?.plant_id;
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      plantId &&
      Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can delete incidents",
        message: "Forbidden: only super_admin or admin assigned to this plant can delete incidents",
      });
    }

    // Clean up dependent foreign keys gracefully
    await db.AuditLogEntry.destroy({ where: { incident_id: incident.id } });
    await db.DetectionEvent.update({ incident_id: null }, { where: { incident_id: incident.id } });
    await incident.destroy();

    return res.status(200).json({
      message: "Incident deleted successfully",
      id: Number(id),
    });
  } catch (error) {
    console.error("Delete incident error:", error);
    return res.status(500).json({
      error: "Failed to delete incident",
      message: error.message,
    });
  }
};

// GET /audit-logs - Paginated list of audit logs across incidents
// Access: super_admin or user assigned to that plant
const listAuditLogs = async (req, res) => {
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
    if (req.query.incident_id) {
      whereClause.incident_id = Number(req.query.incident_id);
    }
    if (req.query.action) {
      whereClause.action = req.query.action;
    }
    if (req.query.actor_id) {
      whereClause.actor_id = Number(req.query.actor_id);
    }

    const { count, rows } = await db.AuditLogEntry.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Incident,
          as: "incident",
          include: [
            {
              model: db.Zone,
              as: "zone",
              where: Object.keys(zoneWhere).length > 0 ? zoneWhere : undefined,
            },
          ],
        },
        {
          model: db.User,
          as: "actor",
          attributes: ["id", "name", "email", "role"],
        },
      ],
      limit,
      offset,
      order: [
        ["created_at", "DESC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List audit logs error:", error);
    return res.status(500).json({
      error: "Failed to retrieve audit logs",
      message: error.message,
    });
  }
};

// GET /audit-logs/:id - Single audit log entry
// Access: user assigned to plant or super_admin
const getAuditLogById = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await db.AuditLogEntry.findByPk(id, {
      include: [
        {
          model: db.Incident,
          as: "incident",
          include: [{ model: db.Zone, as: "zone" }],
        },
        {
          model: db.User,
          as: "actor",
          attributes: ["id", "name", "email", "role"],
        },
      ],
    });

    if (!entry) {
      return res.status(404).json({
        error: "Audit log entry not found",
        message: `Audit log entry with ID ${id} not found`,
      });
    }

    const plantId = entry.incident?.zone?.plant_id;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = plantId && Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this audit log entry",
        message: "Forbidden: you do not have access to this audit log entry",
      });
    }

    return res.status(200).json(entry);
  } catch (error) {
    console.error("Get audit log by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve audit log entry",
      message: error.message,
    });
  }
};

module.exports = {
  getIncidents,
  getIncidentById,
  updateIncident,
  deleteIncident,
  acknowledgeIncident,
  resolveIncident,
  dismissIncident,
  getIncidentAuditLog,
  listAuditLogs,
  getAuditLogById,
};

const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

const ALLOWED_EVENT_TYPES = ["ppe_violation", "restricted_entry", "smoke", "fire"];
const ALLOWED_SEVERITIES = ["low", "medium", "high", "critical"];
const SUPPORTED_PPE = ["helmet", "vest", "boots", "gloves", "glasses", "goggles", "mask", "face_shield", "ear_protection", "harness",];

// Helper to validate PPE array for ppe_violation
function validateRequiredPPE(required_ppe) {
  if (!Array.isArray(required_ppe) || required_ppe.length === 0) {
    return {
      valid: false,
      error: "required_ppe must be a non-empty array of supported PPE items for ppe_violation",
    };
  }

  for (const item of required_ppe) {
    if (typeof item !== "string" || !SUPPORTED_PPE.includes(item.trim().toLowerCase())) {
      return {
        valid: false,
        error: `Unsupported PPE item: "${item}". Supported items are: ${SUPPORTED_PPE.join(", ")}`,
      };
    }
  }

  return {
    valid: true,
    normalized: required_ppe.map((item) => item.trim().toLowerCase()),
  };
}

// POST /zones/:zoneId/safety-rules
// Access: super_admin or admin assigned to zone's plant
const createSafetyRule = async (req, res) => {
  try {
    const { zoneId } = req.params;

    // 1. Find zone and check plant
    const zone = await db.Zone.findByPk(zoneId, {
      include: [{ model: db.Plant, as: "plant" }],
    });

    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${zoneId} not found`,
      });
    }

    if (zone.status !== "active") {
      return res.status(400).json({
        error: "Cannot create safety rule in an inactive zone",
        message: "Cannot create safety rule in an inactive zone",
      });
    }

    // 2. Permission check: super_admin or admin of that plant
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can configure safety rules",
        message: "Forbidden: only super_admin or admin assigned to this plant can configure safety rules",
      });
    }

    // 3. Request body validation
    const { event_type, required_ppe, min_confidence, window_frames, confirming_frames, cooldown_seconds, severity, is_active, camera_region_id, } = req.body;

    if (!event_type || !ALLOWED_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        error: `event_type is required and must be one of: ${ALLOWED_EVENT_TYPES.join(", ")}`,
        message: `event_type is required and must be one of: ${ALLOWED_EVENT_TYPES.join(", ")}`,
      });
    }

    // Camera region validation if provided
    let regionId = null;
    if (camera_region_id !== undefined && camera_region_id !== null) {
      const region = await db.CameraRegion.findByPk(camera_region_id, {
        include: [{ model: db.Camera, as: "camera" }],
      });
      if (!region) {
        return res.status(400).json({
          error: "Camera region not found",
          message: `Camera region with ID ${camera_region_id} not found`,
        });
      }
      if (!region.camera || Number(region.camera.zone_id) !== Number(zoneId)) {
        return res.status(400).json({
          error: "Camera region does not belong to this rule's zone",
          message: "Region's camera must belong to the rule's zone",
        });
      }
      regionId = region.id;
    }

    // PPE validation based on event_type
    let normalizedPPE = null;
    if (event_type === "ppe_violation") {
      const ppeValidation = validateRequiredPPE(required_ppe);
      if (!ppeValidation.valid) {
        return res.status(400).json({
          error: ppeValidation.error,
          message: ppeValidation.error,
        });
      }
      normalizedPPE = ppeValidation.normalized;
    }

    // Window and confirming frames
    const winFrames = window_frames !== undefined ? window_frames : 10;
    const confFrames = confirming_frames !== undefined ? confirming_frames : 6;

    if (!Number.isInteger(winFrames) || winFrames <= 0) {
      return res.status(400).json({
        error: "window_frames must be a positive integer",
        message: "window_frames must be a positive integer",
      });
    }

    if (!Number.isInteger(confFrames) || confFrames <= 0) {
      return res.status(400).json({
        error: "confirming_frames must be a positive integer",
        message: "confirming_frames must be a positive integer",
      });
    }

    if (confFrames > winFrames) {
      return res.status(400).json({
        error: "confirming_frames cannot exceed window_frames",
        message: "confirming_frames cannot exceed window_frames",
      });
    }

    // Min confidence
    const confScore = min_confidence !== undefined ? min_confidence : 0.8;
    if (typeof confScore !== "number" || isNaN(confScore) || confScore < 0 || confScore > 1) {
      return res.status(400).json({
        error: "min_confidence must be a number between 0 and 1",
        message: "min_confidence must be a number between 0 and 1",
      });
    }

    // Cooldown seconds
    const cdSeconds = cooldown_seconds !== undefined ? cooldown_seconds : 30;
    if (!Number.isInteger(cdSeconds) || cdSeconds < 0) {
      return res.status(400).json({
        error: "cooldown_seconds must be a nonnegative integer",
        message: "cooldown_seconds must be a nonnegative integer",
      });
    }

    // Severity
    const ruleSeverity = severity !== undefined ? severity : "medium";
    if (!ALLOWED_SEVERITIES.includes(ruleSeverity)) {
      return res.status(400).json({
        error: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
        message: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
      });
    }

    const ruleActive = is_active !== undefined ? Boolean(is_active) : true;

    // 4. Create rule
    const rule = await db.ZoneSafetyRule.create({
      zone_id: Number(zoneId),
      event_type,
      required_ppe: normalizedPPE,
      min_confidence: confScore,
      window_frames: winFrames,
      confirming_frames: confFrames,
      cooldown_seconds: cdSeconds,
      severity: ruleSeverity,
      is_active: ruleActive,
      camera_region_id: regionId,
    });

    return res.status(201).json(rule);
  } catch (error) {
    console.error("Create safety rule error:", error);
    return res.status(500).json({
      error: "Failed to create safety rule",
      message: error.message,
    });
  }
};

// GET /zones/:zoneId/safety-rules
// Access: user assigned to zone's plant or super_admin
const getSafetyRulesByZone = async (req, res) => {
  try {
    const { zoneId } = req.params;

    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Zone and plant access check
    const zone = await db.Zone.findByPk(zoneId);
    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${zoneId} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this zone's safety rules",
        message: "Forbidden: you do not have access to this zone's safety rules",
      });
    }

    // 3. Filters
    const whereClause = { zone_id: Number(zoneId) };

    if (req.query.event_type) {
      whereClause.event_type = req.query.event_type;
    }

    if (req.query.severity) {
      whereClause.severity = req.query.severity;
    }

    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    // 4. Query
    const { count, rows } = await db.ZoneSafetyRule.findAndCountAll({
      where: whereClause,
      include: [{ model: db.CameraRegion, as: "camera_region" }],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get safety rules by zone error:", error);
    return res.status(500).json({
      error: "Failed to retrieve safety rules",
      message: error.message,
    });
  }
};

// GET /safety-rules
// Access: super_admin or user assigned to that plant
const listSafetyRules = async (req, res) => {
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
    if (req.query.zone_id) {
      whereClause.zone_id = Number(req.query.zone_id);
    }
    if (req.query.event_type) {
      whereClause.event_type = req.query.event_type;
    }
    if (req.query.severity) {
      whereClause.severity = req.query.severity;
    }
    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    const { count, rows } = await db.ZoneSafetyRule.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Zone,
          as: "zone",
          where: Object.keys(zoneWhere).length > 0 ? zoneWhere : undefined,
          include: [{ model: db.Plant, as: "plant" }],
        },
        { model: db.CameraRegion, as: "camera_region" },
      ],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List safety rules error:", error);
    return res.status(500).json({
      error: "Failed to retrieve safety rules",
      message: error.message,
    });
  }
};

// GET /safety-rules/:id
// Access: user assigned to rule's zone's plant or super_admin
const getSafetyRuleById = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.ZoneSafetyRule.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
        {
          model: db.CameraRegion,
          as: "camera_region",
        },
      ],
    });

    if (!rule) {
      return res.status(404).json({
        error: "Safety rule not found",
        message: `Safety rule with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      rule.zone && Number(req.user.plant_id) === Number(rule.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this safety rule",
        message: "Forbidden: you do not have access to this safety rule",
      });
    }

    return res.status(200).json(rule);
  } catch (error) {
    console.error("Get safety rule by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve safety rule",
      message: error.message,
    });
  }
};

// PATCH /safety-rules/:id
// Access: super_admin or admin assigned to rule's plant
const updateSafetyRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.ZoneSafetyRule.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!rule) {
      return res.status(404).json({
        error: "Safety rule not found",
        message: `Safety rule with ID ${id} not found`,
      });
    }

    // Permission check
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      rule.zone &&
      Number(req.user.plant_id) === Number(rule.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can update safety rules",
        message: "Forbidden: only super_admin or admin assigned to this plant can update safety rules",
      });
    }

    if (req.body.id !== undefined || req.body.zone_id !== undefined) {
      return res.status(400).json({
        error: "zone_id and id cannot be modified",
        message: "zone_id and id cannot be modified",
      });
    }

    const { event_type, required_ppe, min_confidence, window_frames, confirming_frames, cooldown_seconds, severity, is_active, camera_region_id, } = req.body;
    const updateData = {};

    // Camera region update
    if (camera_region_id !== undefined) {
      if (camera_region_id === null) {
        updateData.camera_region_id = null;
      } else {
        const region = await db.CameraRegion.findByPk(camera_region_id, {
          include: [{ model: db.Camera, as: "camera" }],
        });
        if (!region) {
          return res.status(400).json({
            error: "Camera region not found",
            message: `Camera region with ID ${camera_region_id} not found`,
          });
        }
        if (!region.camera || Number(region.camera.zone_id) !== Number(rule.zone_id)) {
          return res.status(400).json({
            error: "Camera region does not belong to this rule's zone",
            message: "Region's camera must belong to the rule's zone",
          });
        }
        updateData.camera_region_id = region.id;
      }
    }

    // Determine target event_type
    const targetEventType = event_type !== undefined ? event_type : rule.event_type;
    if (event_type !== undefined) {
      if (!ALLOWED_EVENT_TYPES.includes(event_type)) {
        return res.status(400).json({
          error: `event_type must be one of: ${ALLOWED_EVENT_TYPES.join(", ")}`,
          message: `event_type must be one of: ${ALLOWED_EVENT_TYPES.join(", ")}`,
        });
      }
      updateData.event_type = event_type;
    }

    // Determine PPE
    if (targetEventType === "ppe_violation") {
      if (required_ppe !== undefined) {
        const ppeValidation = validateRequiredPPE(required_ppe);
        if (!ppeValidation.valid) {
          return res.status(400).json({
            error: ppeValidation.error,
            message: ppeValidation.error,
          });
        }
        updateData.required_ppe = ppeValidation.normalized;
      } else if (event_type !== undefined && !rule.required_ppe) {
        return res.status(400).json({
          error: "required_ppe is required when changing event_type to ppe_violation",
          message: "required_ppe is required when changing event_type to ppe_violation",
        });
      }
    } else {
      // Other event types do not need PPE
      if (required_ppe !== undefined || event_type !== undefined) {
        updateData.required_ppe = null;
      }
    }

    // Window and confirming frames validation
    const targetWinFrames = window_frames !== undefined ? window_frames : rule.window_frames;
    const targetConfFrames = confirming_frames !== undefined ? confirming_frames : rule.confirming_frames;

    if (window_frames !== undefined) {
      if (!Number.isInteger(window_frames) || window_frames <= 0) {
        return res.status(400).json({
          error: "window_frames must be a positive integer",
          message: "window_frames must be a positive integer",
        });
      }
      updateData.window_frames = window_frames;
    }

    if (confirming_frames !== undefined) {
      if (!Number.isInteger(confirming_frames) || confirming_frames <= 0) {
        return res.status(400).json({
          error: "confirming_frames must be a positive integer",
          message: "confirming_frames must be a positive integer",
        });
      }
      updateData.confirming_frames = confirming_frames;
    }

    if (targetConfFrames > targetWinFrames) {
      return res.status(400).json({
        error: "confirming_frames cannot exceed window_frames",
        message: "confirming_frames cannot exceed window_frames",
      });
    }

    // Min confidence
    if (min_confidence !== undefined) {
      if (typeof min_confidence !== "number" || isNaN(min_confidence) || min_confidence < 0 || min_confidence > 1) {
        return res.status(400).json({
          error: "min_confidence must be a number between 0 and 1",
          message: "min_confidence must be a number between 0 and 1",
        });
      }
      updateData.min_confidence = min_confidence;
    }

    // Cooldown seconds
    if (cooldown_seconds !== undefined) {
      if (!Number.isInteger(cooldown_seconds) || cooldown_seconds < 0) {
        return res.status(400).json({
          error: "cooldown_seconds must be a nonnegative integer",
          message: "cooldown_seconds must be a nonnegative integer",
        });
      }
      updateData.cooldown_seconds = cooldown_seconds;
    }

    // Severity
    if (severity !== undefined) {
      if (!ALLOWED_SEVERITIES.includes(severity)) {
        return res.status(400).json({
          error: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
          message: `severity must be one of: ${ALLOWED_SEVERITIES.join(", ")}`,
        });
      }
      updateData.severity = severity;
    }

    // is_active
    if (is_active !== undefined) {
      updateData.is_active = Boolean(is_active);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: "No valid fields provided for update",
        message: "No valid fields provided for update",
      });
    }

    await rule.update(updateData);

    const updatedRule = await db.ZoneSafetyRule.findByPk(rule.id, {
      include: [
        { model: db.Zone, as: "zone" },
        { model: db.CameraRegion, as: "camera_region" },
      ],
    });

    return res.status(200).json(updatedRule);
  } catch (error) {
    console.error("Update safety rule error:", error);
    return res.status(500).json({ error: "Failed to update safety rule", message: error.message, });
  }
};

// DELETE /safety-rules/:id
// Access: super_admin or admin assigned to rule's plant
// Soft disables the rule (sets is_active to false)
const deleteSafetyRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.ZoneSafetyRule.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!rule) {
      return res.status(404).json({
        error: "Safety rule not found",
        message: `Safety rule with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      rule.zone &&
      Number(req.user.plant_id) === Number(rule.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can disable safety rules",
        message: "Forbidden: only super_admin or admin assigned to this plant can disable safety rules",
      });
    }

    const force = req.query.force === "true" || req.query.permanent === "true";
    if (force) {
      await rule.destroy();
      return res.status(200).json({
        message: "Safety rule deleted permanently",
        id: Number(id),
      });
    }

    await rule.update({ is_active: false });

    return res.status(200).json({
      message: "Safety rule disabled successfully",
      ...rule.toJSON(),
      safety_rule: rule,
    });
  } catch (error) {
    console.error("Delete safety rule error:", error);
    return res.status(500).json({ error: "Failed to delete safety rule", message: error.message, });
  }
};

module.exports = { createSafetyRule, listSafetyRules, getSafetyRulesByZone, getSafetyRuleById, updateSafetyRule, deleteSafetyRule, };

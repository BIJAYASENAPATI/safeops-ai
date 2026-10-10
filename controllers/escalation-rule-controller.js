const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

const ALLOWED_SEVERITY_THRESHOLDS = ["low", "medium", "high", "critical"];

// Helper to validate contact eligibility for escalation
async function validateEscalationContact(contactId, plantId) {
  if (!contactId || isNaN(contactId)) {
    return { valid: false, status: 400, error: "escalation_contact_id is required and must be a valid user ID" };
  }

  const contact = await db.User.findByPk(contactId);
  if (!contact) {
    return { valid: false, status: 404, error: `Escalation contact user with ID ${contactId} not found` };
  }

  // Must be active and accepted
  if (contact.account_status !== "active" || contact.invite_status !== "accepted") {
    return {
      valid: false,
      status: 400,
      error: "Escalation contact must have an active and accepted account",
    };
  }

  // Role must be manager or admin
  if (!["manager", "admin"].includes(contact.role)) {
    return {
      valid: false,
      status: 400,
      error: "Escalation contact must have role 'manager' or 'admin'",
    };
  }

  // Must be assigned to the same plant
  if (!contact.plant_id || Number(contact.plant_id) !== Number(plantId)) {
    return {
      valid: false,
      status: 400,
      error: "Escalation contact must be assigned to the same plant as the zone",
    };
  }

  return { valid: true, contact };
}

// POST /zones/:zoneId/escalation-rules
// Access: super_admin or admin assigned to zone's plant
const createEscalationRule = async (req, res) => {
  try {
    const { zoneId } = req.params;

    const zone = await db.Zone.findByPk(zoneId, {
      include: [{ model: db.Plant, as: "plant" }],
    });

    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${zoneId} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can configure escalation rules",
        message: "Forbidden: only super_admin or admin can configure escalation rules",
      });
    }

    const { severity_threshold, timeout_minutes, escalation_contact_id, is_active } = req.body;

    // Validate severity_threshold
    if (!severity_threshold || !ALLOWED_SEVERITY_THRESHOLDS.includes(severity_threshold)) {
      return res.status(400).json({
        error: `severity_threshold must be one of: ${ALLOWED_SEVERITY_THRESHOLDS.join(", ")}`,
        message: `severity_threshold must be one of: ${ALLOWED_SEVERITY_THRESHOLDS.join(", ")}`,
      });
    }

    // Validate timeout_minutes (positive integer)
    const timeout = Number(timeout_minutes);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      return res.status(400).json({
        error: "timeout_minutes must be a positive integer greater than 0",
        message: "timeout_minutes must be a positive integer greater than 0",
      });
    }

    // Validate escalation contact
    const contactCheck = await validateEscalationContact(escalation_contact_id, zone.plant_id);
    if (!contactCheck.valid) {
      return res.status(contactCheck.status).json({
        error: contactCheck.error,
        message: contactCheck.error,
      });
    }

    // Check unique rule per zone and threshold - update if exists instead of creating duplicate
    const existingRule = await db.EscalationRule.findOne({
      where: {
        zone_id: Number(zoneId),
        severity_threshold,
      },
    });

    if (existingRule) {
      await existingRule.update({
        timeout_minutes: timeout,
        escalation_contact_id: Number(escalation_contact_id),
        is_active: is_active !== undefined ? Boolean(is_active) : true,
      });

      const fullRule = await db.EscalationRule.findByPk(existingRule.id, {
        include: [
          { model: db.Zone, as: "zone" },
          { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
        ],
      });

      return res.status(200).json(fullRule);
    }

    const rule = await db.EscalationRule.create({
      zone_id: Number(zoneId),
      severity_threshold,
      timeout_minutes: timeout,
      escalation_contact_id: Number(escalation_contact_id),
      is_active: is_active !== undefined ? Boolean(is_active) : true,
    });

    const fullRule = await db.EscalationRule.findByPk(rule.id, {
      include: [
        { model: db.Zone, as: "zone" },
        { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
      ],
    });

    return res.status(201).json(fullRule);
  } catch (error) {
    console.error("Create escalation rule error:", error);
    return res.status(500).json({
      error: "Failed to create escalation rule",
      message: error.message,
    });
  }
};

// GET /zones/:zoneId/escalation-rules
// Access: super_admin or user assigned to zone's plant
const getEscalationRulesByZone = async (req, res) => {
  try {
    const { zoneId } = req.params;

    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error });
    }
    const { page, limit, offset } = pagination;

    const zone = await db.Zone.findByPk(zoneId);
    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${zoneId} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isAssigned = Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this zone's escalation rules",
        message: "Forbidden: you do not have access to this zone's escalation rules",
      });
    }

    const whereClause = { zone_id: Number(zoneId) };
    if (req.query.severity_threshold) {
      whereClause.severity_threshold = req.query.severity_threshold;
    }
    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    const { count, rows } = await db.EscalationRule.findAndCountAll({
      where: whereClause,
      include: [
        { model: db.Zone, as: "zone" },
        { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
      ],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get escalation rules by zone error:", error);
    return res.status(500).json({
      error: "Failed to retrieve escalation rules",
      message: error.message,
    });
  }
};

// GET /escalation-rules
// Access: super_admin or user assigned to plant
const listEscalationRules = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error });
    }
    const { page, limit, offset } = pagination;

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const userPlantId = req.user.plant_id;

    const zoneWhere = {};
    if (!isSuperAdmin && !isAdmin) {
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
    if (req.query.severity_threshold) {
      whereClause.severity_threshold = req.query.severity_threshold;
    }
    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    const { count, rows } = await db.EscalationRule.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Zone,
          as: "zone",
          where: Object.keys(zoneWhere).length > 0 ? zoneWhere : undefined,
          include: [{ model: db.Plant, as: "plant" }],
        },
        { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
      ],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List escalation rules error:", error);
    return res.status(500).json({
      error: "Failed to retrieve escalation rules",
      message: error.message,
    });
  }
};

// GET /escalation-rules/:id
// Access: super_admin or user assigned to rule's plant
const getEscalationRuleById = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.EscalationRule.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
        { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
      ],
    });

    if (!rule) {
      return res.status(404).json({
        error: "Escalation rule not found",
        message: `Escalation rule with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isAssigned =
      rule.zone && Number(req.user.plant_id) === Number(rule.zone.plant_id);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this escalation rule",
        message: "Forbidden: you do not have access to this escalation rule",
      });
    }

    return res.status(200).json(rule);
  } catch (error) {
    console.error("Get escalation rule by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve escalation rule",
      message: error.message,
    });
  }
};

// PATCH /escalation-rules/:id
// Access: super_admin or admin assigned to rule's plant
const updateEscalationRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.EscalationRule.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!rule) {
      return res.status(404).json({
        error: "Escalation rule not found",
        message: `Escalation rule with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can update escalation rules",
        message: "Forbidden: only super_admin or admin can update escalation rules",
      });
    }

    const { severity_threshold, timeout_minutes, escalation_contact_id, is_active } = req.body;
    const updates = {};

    if (severity_threshold !== undefined) {
      if (!ALLOWED_SEVERITY_THRESHOLDS.includes(severity_threshold)) {
        return res.status(400).json({
          error: `severity_threshold must be one of: ${ALLOWED_SEVERITY_THRESHOLDS.join(", ")}`,
          message: `severity_threshold must be one of: ${ALLOWED_SEVERITY_THRESHOLDS.join(", ")}`,
        });
      }
      if (severity_threshold !== rule.severity_threshold) {
        const conflict = await db.EscalationRule.findOne({
          where: {
            zone_id: rule.zone_id,
            severity_threshold,
            id: { [Op.ne]: rule.id },
          },
        });
        if (conflict) {
          return res.status(409).json({
            error: `An escalation rule for zone ${rule.zone_id} with threshold '${severity_threshold}' already exists`,
            message: `An escalation rule for zone ${rule.zone_id} with threshold '${severity_threshold}' already exists`,
          });
        }
        updates.severity_threshold = severity_threshold;
      }
    }

    if (timeout_minutes !== undefined) {
      const timeout = Number(timeout_minutes);
      if (!Number.isInteger(timeout) || timeout <= 0) {
        return res.status(400).json({
          error: "timeout_minutes must be a positive integer greater than 0",
          message: "timeout_minutes must be a positive integer greater than 0",
        });
      }
      updates.timeout_minutes = timeout;
    }

    if (escalation_contact_id !== undefined) {
      const contactCheck = await validateEscalationContact(
        escalation_contact_id,
        rule.zone.plant_id
      );
      if (!contactCheck.valid) {
        return res.status(contactCheck.status).json({
          error: contactCheck.error,
          message: contactCheck.error,
        });
      }
      updates.escalation_contact_id = Number(escalation_contact_id);
    }

    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    if (Object.keys(updates).length > 0) {
      await rule.update(updates);
    }

    const updatedRule = await db.EscalationRule.findByPk(id, {
      include: [
        { model: db.Zone, as: "zone" },
        { model: db.User, as: "escalation_contact", attributes: ["id", "name", "email", "role", "plant_id"] },
      ],
    });

    return res.status(200).json(updatedRule);
  } catch (error) {
    console.error("Update escalation rule error:", error);
    return res.status(500).json({ error: "Failed to update escalation rule", message: error.message, });
  }
};

// DELETE /escalation-rules/:id
// Access: super_admin or admin assigned to rule's plant
const deleteEscalationRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await db.EscalationRule.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!rule) {
      return res.status(404).json({ error: "Escalation rule not found", message: `Escalation rule with ID ${id} not found`, });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can disable escalation rules",
        message: "Forbidden: only super_admin or admin can disable escalation rules",
      });
    }

    const force = req.query.force === "true" || req.query.permanent === "true";
    if (force) {
      await rule.destroy();
      return res.status(200).json({ message: "Escalation rule deleted permanently", id: Number(id), });
    }

    await rule.update({ is_active: false });

    return res.status(200).json({
      message: "Escalation rule disabled successfully",
      ...rule.toJSON(),
      escalation_rule: rule,
    });
  } catch (error) {
    console.error("Delete escalation rule error:", error);
    return res.status(500).json({ error: "Failed to delete escalation rule", message: error.message, });
  }
};

module.exports = { createEscalationRule, getEscalationRulesByZone, listEscalationRules, getEscalationRuleById, updateEscalationRule, deleteEscalationRule, };
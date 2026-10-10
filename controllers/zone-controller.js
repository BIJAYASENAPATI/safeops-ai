const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

//  POST /plants/:plantId/zones or POST /zones - Access: Super admin or admin
const createZone = async (req, res) => {
  try {
    const plantId = req.params.plantId || req.body.plant_id || req.body.plantId;

    if (!plantId) {
      return res.status(400).json({
        error: "plant_id is required",
        message: "plant_id is required",
      });
    }

    // 1. Role permission check: super_admin or admin can create zones under any plant
    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can create zones",
        message: "Forbidden: only super_admin or admin can create zones",
      });
    }

    // 2. Check plant exists and is active
    const plant = await db.Plant.findByPk(plantId);
    if (!plant) {
      return res.status(404).json({
        error: "Plant not found",
        message: `Plant with ID ${plantId} not found`,
      });
    }

    if (plant.status !== "active") {
      return res.status(400).json({
        error: "Cannot create zone in an inactive plant",
        message: "Cannot create zone in an inactive plant",
      });
    }

    // 3. Validation
    const { name, severity_level, type, operating_schedule, boundaries, coordinates, polygon, status } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required and must be a non-empty string",
        message: "Name is required and must be a non-empty string",
      });
    }

    const targetSeverity = severity_level || type;
    const allowedSeverities = ["low", "medium", "high", "critical"];
    if (!targetSeverity || !allowedSeverities.includes(targetSeverity)) {
      return res.status(400).json({
        error: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
        message: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
      });
    }

    if (status !== undefined && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        error: "status must be either 'active' or 'inactive'",
        message: "status must be either 'active' or 'inactive'",
      });
    }

    let finalSchedule = operating_schedule !== undefined ? operating_schedule : null;
    const boundData = boundaries || coordinates || polygon;
    if (boundData !== undefined) {
      if (typeof finalSchedule === "object" && finalSchedule !== null) {
        finalSchedule = { ...finalSchedule, boundaries: boundData };
      } else {
        finalSchedule = { schedule: finalSchedule, boundaries: boundData };
      }
    }

    // 4. Create zone
    const zone = await db.Zone.create({
      plant_id: Number(plantId),
      name: name.trim(),
      severity_level: targetSeverity,
      operating_schedule: finalSchedule,
      status: status || "active",
    });

    return res.status(201).json(zone);
  } catch (error) {
    console.error("Create zone error:", error);
    return res.status(500).json({ error: "Failed to create zone", message: error.message, });
  }
};

// GET /zones - Access: Signed-in user (admin & super_admin see all zones, other users see assigned plant's zones)
const listZones = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error, });
    }
    const { page, limit, offset } = pagination;

    let whereClause = {};

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      if (!req.user.plant_id) {
        return res.status(200).json(formatPaginatedResponse([], 0, page, limit));
      }
      whereClause.plant_id = req.user.plant_id;
    } else if (req.query.plant_id) {
      whereClause.plant_id = req.query.plant_id;
    }

    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.severity_level) {
      whereClause.severity_level = req.query.severity_level;
    }
    if (req.query.search && req.query.search.trim()) {
      whereClause.name = { [Op.like]: `%${req.query.search.trim()}%` };
    }

    const { count, rows } = await db.Zone.findAndCountAll({
      where: whereClause,
      include: [{ model: db.Plant, as: "plant" }],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List zones error:", error);
    return res.status(500).json({ error: "Failed to retrieve zones", message: error.message });
  }
};

// GET /plants/:plantId/zones - Access: User assigned to that plant, admin, or super admin
const getZonesByPlant = async (req, res) => {
  try {
    // 1-4. Read, validate and calculate pagination parameters
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error, });
    }
    const { page, limit, offset } = pagination;

    const { plantId } = req.params;

    // 5. Apply plant permissions, search, and other filters
    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isAssigned = Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: access to this plant's zones is not permitted",
        message: "Forbidden: access to this plant's zones is not permitted",
      });
    }

    const plant = await db.Plant.findByPk(plantId);
    if (!plant) {
      return res.status(404).json({ error: "Plant not found", message: `Plant with ID ${plantId} not found`, });
    }

    const whereClause = { plant_id: plantId };
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.severity_level) {
      whereClause.severity_level = req.query.severity_level;
    }
    if (req.query.search && req.query.search.trim()) {
      whereClause.name = { [Op.like]: `%${req.query.search.trim()}%` };
    }

    // 6. Use findAndCountAll({ where, limit, offset, order: [["id", "ASC"]] })
    const { count, rows } = await db.Zone.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    // 7. Return standard paginated response structure
    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get zones by plant error:", error);
    return res.status(500).json({ error: "Failed to retrieve zones", message: error.message, });
  }
};

//  GET /zones/:id - Access: User assigned to the zone's plant, admin, or super admin
const getZoneById = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await db.Zone.findByPk(id, {
      include: [{ model: db.Plant, as: "plant" }],
    });

    if (!zone) {
      return res.status(404).json({ error: "Zone not found", message: `Zone with ID ${id} not found`, });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isAssigned = Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this zone",
        message: "Forbidden: you do not have access to this zone",
      });
    }

    return res.status(200).json(zone);
  } catch (error) {
    console.error("Get zone by ID error:", error);
    return res.status(500).json({ error: "Failed to retrieve zone", message: error.message, });
  }
};

//  PATCH /zones/:id - Access: Super admin or admin
const updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await db.Zone.findByPk(id);

    if (!zone) {
      return res.status(404).json({ error: "Zone not found", message: `Zone with ID ${id} not found`, });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can update this zone",
        message: "Forbidden: only super_admin or admin can update this zone",
      });
    }

    const { name, severity_level, type, operating_schedule, boundaries, coordinates, polygon, status, plant_id } = req.body;
    const updateData = {};

    if (plant_id !== undefined) {
      const targetPlant = await db.Plant.findByPk(plant_id);
      if (!targetPlant) {
        return res.status(404).json({
          error: "Plant not found",
          message: `Plant with ID ${plant_id} not found`,
        });
      }
      if (targetPlant.status !== "active") {
        return res.status(400).json({
          error: "Cannot move zone to an inactive plant",
          message: "Cannot move zone to an inactive plant",
        });
      }
      updateData.plant_id = Number(plant_id);
    }

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          error: "Name must be a non-empty string",
          message: "Name must be a non-empty string",
        });
      }
      updateData.name = name.trim();
    }

    const targetSeverity = severity_level !== undefined ? severity_level : type;
    if (targetSeverity !== undefined) {
      const allowedSeverities = ["low", "medium", "high", "critical"];
      if (!allowedSeverities.includes(targetSeverity)) {
        return res.status(400).json({
          error: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
          message: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
        });
      }
      updateData.severity_level = targetSeverity;
    }

    if (operating_schedule !== undefined) {
      updateData.operating_schedule = operating_schedule;
    }

    const boundData = boundaries || coordinates || polygon;
    if (boundData !== undefined) {
      let sched = updateData.operating_schedule !== undefined ? updateData.operating_schedule : zone.operating_schedule;
      if (typeof sched === "string") {
        try { sched = JSON.parse(sched); } catch (e) { sched = {}; }
      } else if (!sched || typeof sched !== "object") {
        sched = {};
      }
      updateData.operating_schedule = { ...sched, boundaries: boundData };
    }

    if (status !== undefined) {
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          error: "status must be either 'active' or 'inactive'",
          message: "status must be either 'active' or 'inactive'",
        });
      }
      updateData.status = status;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid fields provided for update", message: "No valid fields provided for update", });
    }

    await zone.update(updateData);
    return res.status(200).json(zone);
  } catch (error) {
    console.error("Update zone error:", error);
    return res.status(500).json({ error: "Failed to update zone", message: error.message, });
  }
};

// PATCH/POST /zones/:id/enable - Access: Super admin or admin
const enableZone = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to enable zones",
      });
    }

    const zone = await db.Zone.findByPk(id, {
      include: [{ model: db.Plant, as: "plant" }],
    });

    if (!zone) {
      return res.status(404).json({ error: "Zone not found", message: `Zone with ID ${id} not found` });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can enable this zone",
        message: "Forbidden: only super_admin or admin can enable this zone",
      });
    }

    // Check if parent plant exists and is active
    const plant = zone.plant || (await db.Plant.findByPk(zone.plant_id));
    if (plant && plant.status !== "active") {
      return res.status(400).json({
        error: "Cannot enable zone in an inactive plant",
        message: "Cannot enable zone in an inactive plant",
      });
    }

    await zone.update({ status: "active" });

    return res.status(200).json({
      message: "Zone enabled successfully",
      ...zone.toJSON(),
      zone,
    });
  } catch (error) {
    console.error("Enable zone error:", error);
    return res.status(500).json({ error: "Failed to enable zone", message: error.message });
  }
};

// PATCH/POST /zones/:id/disable - Access: Super admin or admin
const disableZone = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to disable zones",
      });
    }

    const zone = await db.Zone.findByPk(id);

    if (!zone) {
      return res.status(404).json({ error: "Zone not found", message: `Zone with ID ${id} not found` });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin can disable this zone",
        message: "Forbidden: only super_admin or admin can disable this zone",
      });
    }

    await zone.update({ status: "inactive" });

    return res.status(200).json({
      message: "Zone deactivated successfully",
      ...zone.toJSON(),
      zone,
    });
  } catch (error) {
    console.error("Disable zone error:", error);
    return res.status(500).json({ error: "Failed to deactivate zone", message: error.message });
  }
};

// PATCH /zones/:id/status - Update zone status (active/inactive)
const updateZoneStatus = async (req, res) => {
  const { status } = req.body;
  if (!status || !["active", "inactive"].includes(status)) {
    return res.status(400).json({
      error: "status must be either 'active' or 'inactive'",
      message: "status must be either 'active' or 'inactive'",
    });
  }
  if (status === "active") {
    return enableZone(req, res);
  } else {
    return disableZone(req, res);
  }
};

// DELETE /zones/:id - Access: Super admin or admin (sets status: "inactive")
const deleteZone = async (req, res) => {
  return disableZone(req, res);
};

module.exports = { createZone, listZones, getZonesByPlant, getZoneById, updateZone, deleteZone, enableZone, disableZone, updateZoneStatus, };
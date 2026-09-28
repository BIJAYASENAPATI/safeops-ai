const db = require("../db/db-connection");

//  POST /plants/:plantId/zones -  Access: Super admin or admin assigned to that plant
const createZone = async (req, res) => {
  try {
    const { plantId } = req.params;

    // 1. Role & plant permission check
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin = req.user.role === "admin" && Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or assigned plant admin can create zones",
        message: "Forbidden: only super_admin or assigned plant admin can create zones",
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
    const { name, severity_level, operating_schedule, status } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required and must be a non-empty string",
        message: "Name is required and must be a non-empty string",
      });
    }

    const allowedSeverities = ["low", "medium", "high", "critical"];
    if (!severity_level || !allowedSeverities.includes(severity_level)) {
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

    // 4. Create zone (plant_id taken strictly from req.params.plantId)
    const zone = await db.Zone.create({
      plant_id: Number(plantId),
      name: name.trim(),
      severity_level,
      operating_schedule: operating_schedule !== undefined ? operating_schedule : null,
      status: status || "active",
    });

    return res.status(201).json(zone);
  } catch (error) {
    console.error("Create zone error:", error);
    return res.status(500).json({ error: "Failed to create zone", message: error.message, });
  }
};

// GET /plants/:plantId/zones -  Access: User assigned to that plant or super admin
const getZonesByPlant = async (req, res) => {
  try {
    const { plantId } = req.params;

    // 1. Check access
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = Number(req.user.plant_id) === Number(plantId);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: access to this plant's zones is not permitted",
        message: "Forbidden: access to this plant's zones is not permitted",
      });
    }

    // 2. Check plant exists
    const plant = await db.Plant.findByPk(plantId);
    if (!plant) {
      return res.status(404).json({
        error: "Plant not found",
        message: `Plant with ID ${plantId} not found`,
      });
    }

    // 3. Retrieve zones
    const zones = await db.Zone.findAll({
      where: { plant_id: plantId },
      order: [["id", "ASC"]],
    });

    return res.status(200).json(zones);
  } catch (error) {
    console.error("Get zones by plant error:", error);
    return res.status(500).json({ error: "Failed to retrieve zones", message: error.message, });
  }
};

//  GET /zones/:id -  Access: User assigned to the zone's plant or super admin
const getZoneById = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await db.Zone.findByPk(id);

    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
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

//  PATCH /zones/:id -  Access: Super admin or admin assigned to the zone's plant
const updateZone = async (req, res) => {
  try {
    const { id } = req.params;
    const zone = await db.Zone.findByPk(id);

    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin = req.user.role === "admin" && Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or assigned plant admin can update this zone",
        message: "Forbidden: only super_admin or assigned plant admin can update this zone",
      });
    }

    const { name, severity_level, operating_schedule, status } = req.body;
    const updateData = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          error: "Name must be a non-empty string",
          message: "Name must be a non-empty string",
        });
      }
      updateData.name = name.trim();
    }

    if (severity_level !== undefined) {
      const allowedSeverities = ["low", "medium", "high", "critical"];
      if (!allowedSeverities.includes(severity_level)) {
        return res.status(400).json({
          error: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
          message: `severity_level must be one of: ${allowedSeverities.join(", ")}`,
        });
      }
      updateData.severity_level = severity_level;
    }

    if (operating_schedule !== undefined) {
      updateData.operating_schedule = operating_schedule;
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
      return res.status(400).json({
        error: "No valid fields provided for update",
        message: "No valid fields provided for update",
      });
    }

    await zone.update(updateData);
    return res.status(200).json(zone);
  } catch (error) {
    console.error("Update zone error:", error);
    return res.status(500).json({ error: "Failed to update zone", message: error.message, });
  }
};

module.exports = { createZone, getZonesByPlant, getZoneById, updateZone, };
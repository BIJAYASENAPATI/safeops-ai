const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

//  POST /plants :- Access: super_admin only, Create a new plant. Validate name, address, timezone, status.
const createPlant = async (req, res) => {
  try {
    const { name, address, timezone, status } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required and must be a non-empty string",
        message: "Name is required and must be a non-empty string",
      });
    }

    if (!address || typeof address !== "string" || !address.trim()) {
      return res.status(400).json({
        error: "Address is required and must be a non-empty string",
        message: "Address is required and must be a non-empty string",
      });
    }

    if (!timezone || typeof timezone !== "string" || !timezone.trim()) {
      return res.status(400).json({
        error: "Timezone is required and must be a non-empty string",
        message: "Timezone is required and must be a non-empty string",
      });
    }

    if (status !== undefined && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        error: "Status must be either 'active' or 'inactive'",
        message: "Status must be either 'active' or 'inactive'",
      });
    }

    const plant = await db.Plant.create({
      name: name.trim(),
      address: address.trim(),
      timezone: timezone.trim(),
      status: status || "active",
    });

    return res.status(201).json(plant);
  } catch (error) {
    console.error("Create plant error:", error);
    return res.status(500).json({ error: "Failed to create plant", message: error.message, });
  }
};

//  GET /plants -  Access: Signed-in user,  super_admin sees all; other users see only their assigned plant.
const getAllPlants = async (req, res) => {
  try {
    // 1-4. Read, validate and calculate pagination parameters
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error, });
    }
    const { page, limit, offset } = pagination;

    // 5. Apply plant permissions, search, and other filters
    let whereClause = {};

    if (req.user.role !== "super_admin") {
      if (!req.user.plant_id) {
        return res.status(200).json(formatPaginatedResponse([], 0, page, limit));
      }
      whereClause.id = req.user.plant_id;
    }

    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.search && req.query.search.trim()) {
      const searchTerm = `%${req.query.search.trim()}%`;
      whereClause[Op.or] = [
        { name: { [Op.like]: searchTerm } },
        { address: { [Op.like]: searchTerm } },
      ];
    }

    // 6. Use findAndCountAll({ where, limit, offset, order: [["id", "ASC"]] })
    const { count, rows } = await db.Plant.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    // 7. Return standard paginated response structure
    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get all plants error:", error);
    return res.status(500).json({ error: "Failed to fetch plants", message: error.message, });
  }
};

//  GET /plants/:id -  Access: Assigned user or super_admin
const getPlantById = async (req, res) => {
  try {
    const { id } = req.params;
    const plant = await db.Plant.findByPk(id);

    if (!plant) {
      return res.status(404).json({ error: "Plant not found", message: "Plant not found", });
    }

    return res.status(200).json(plant);
  } catch (error) {
    console.error("Get plant by ID error:", error);
    return res.status(500).json({ error: "Failed to fetch plant", message: error.message, });
  }
};

//  PATCH /plants/:id -  Access: super_admin only, Update name, address, timezone, or status.
const updatePlant = async (req, res) => {
  try {
    const { id } = req.params;
    const plant = await db.Plant.findByPk(id);

    if (!plant) {
      return res.status(404).json({
        error: "Plant not found",
        message: "Plant not found",
      });
    }

    const { name, address, timezone, status } = req.body;
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

    if (address !== undefined) {
      if (typeof address !== "string" || !address.trim()) {
        return res.status(400).json({
          error: "Address must be a non-empty string",
          message: "Address must be a non-empty string",
        });
      }
      updateData.address = address.trim();
    }

    if (timezone !== undefined) {
      if (typeof timezone !== "string" || !timezone.trim()) {
        return res.status(400).json({
          error: "Timezone must be a non-empty string",
          message: "Timezone must be a non-empty string",
        });
      }
      updateData.timezone = timezone.trim();
    }

    if (status !== undefined) {
      if (!["active", "inactive"].includes(status)) {
        return res.status(400).json({
          error: "Status must be either 'active' or 'inactive'",
          message: "Status must be either 'active' or 'inactive'",
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

    await plant.update(updateData);
    return res.status(200).json(plant);
  } catch (error) {
    console.error("Update plant error:", error);
    return res.status(500).json({ error: "Failed to update plant", message: error.message, });
  }
};

// PATCH/POST /plants/:id/enable - Access: super_admin only
const enablePlant = async (req, res) => {
  try {
    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to enable plants",
      });
    }

    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        error: "Forbidden: only super_admin can enable plants",
        message: "Forbidden: only super_admin can enable plants",
      });
    }

    const { id } = req.params;
    const plant = await db.Plant.findByPk(id);

    if (!plant) {
      return res.status(404).json({
        error: "Plant not found",
        message: "Plant not found",
      });
    }

    await plant.update({ status: "active" });

    return res.status(200).json({
      message: "Plant enabled successfully",
      ...plant.toJSON(),
      plant,
    });
  } catch (error) {
    console.error("Enable plant error:", error);
    return res.status(500).json({
      error: "Failed to enable plant",
      message: error.message,
    });
  }
};

// PATCH/POST /plants/:id/disable - Access: super_admin only
const disablePlant = async (req, res) => {
  try {
    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to disable plants",
      });
    }

    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        error: "Forbidden: only super_admin can disable plants",
        message: "Forbidden: only super_admin can disable plants",
      });
    }

    const { id } = req.params;
    const plant = await db.Plant.findByPk(id);

    if (!plant) {
      return res.status(404).json({
        error: "Plant not found",
        message: "Plant not found",
      });
    }

    await plant.update({ status: "inactive" });

    return res.status(200).json({
      message: "Plant deactivated successfully",
      ...plant.toJSON(),
      plant,
    });
  } catch (error) {
    console.error("Disable plant error:", error);
    return res.status(500).json({
      error: "Failed to deactivate plant",
      message: error.message,
    });
  }
};

// PATCH /plants/:id/status - Update plant status (active/inactive)
const updatePlantStatus = async (req, res) => {
  const { status } = req.body;
  if (!status || !["active", "inactive"].includes(status)) {
    return res.status(400).json({
      error: "status must be either 'active' or 'inactive'",
      message: "status must be either 'active' or 'inactive'",
    });
  }
  if (status === "active") {
    return enablePlant(req, res);
  } else {
    return disablePlant(req, res);
  }
};

// DELETE /plants/:id - Access: super_admin only - Deactivate plant (set status: "inactive")
const deletePlant = async (req, res) => {
  return disablePlant(req, res);
};

module.exports = { createPlant, getAllPlants, getPlantById, updatePlant, deletePlant, enablePlant, disablePlant, updatePlantStatus, };
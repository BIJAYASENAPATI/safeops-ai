const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");
const { validatePolygon } = require("../utils/polygon");

// POST /cameras/:cameraId/regions
// Access: super_admin or admin assigned to camera's plant
const createCameraRegion = async (req, res) => {
  try {
    const { cameraId } = req.params;

    // 1. Find camera with its zone
    const camera = await db.Camera.findByPk(cameraId, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!camera) {
      return res.status(404).json({
        error: "Camera not found",
        message: `Camera with ID ${cameraId} not found`,
      });
    }

    if (!camera.zone) {
      return res.status(400).json({
        error: "Camera is not assigned to a valid zone",
        message: "Camera is not assigned to a valid zone",
      });
    }

    // 2. Permission check: super_admin or plant admin of camera's plant
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can configure camera regions",
        message: "Forbidden: only super_admin or admin assigned to this plant can configure camera regions",
      });
    }

    // 3. Validation
    const { name, polygon, safety_rule_id, is_active } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required and must be a non-empty string",
        message: "Name is required and must be a non-empty string",
      });
    }

    // Validate polygon
    const polygonCheck = validatePolygon(polygon);
    if (!polygonCheck.valid) {
      return res.status(400).json({
        error: polygonCheck.error,
        message: polygonCheck.error,
      });
    }

    // Validate safety rule if linked
    let linkedRuleId = null;
    if (safety_rule_id !== undefined && safety_rule_id !== null) {
      const rule = await db.ZoneSafetyRule.findByPk(safety_rule_id);
      if (!rule) {
        return res.status(404).json({
          error: "Safety rule not found",
          message: `Safety rule with ID ${safety_rule_id} not found`,
        });
      }

      if (Number(rule.zone_id) !== Number(camera.zone_id)) {
        return res.status(400).json({
          error: "Safety rule does not belong to the camera's zone",
          message: `Safety rule (Zone ID ${rule.zone_id}) does not belong to this camera's zone (Zone ID ${camera.zone_id})`,
        });
      }
      linkedRuleId = Number(safety_rule_id);
    }

    // 4. Create region
    const region = await db.CameraRegion.create({
      camera_id: Number(cameraId),
      safety_rule_id: linkedRuleId,
      name: name.trim(),
      polygon,
      is_active: is_active !== undefined ? Boolean(is_active) : true,
    });

    return res.status(201).json(region);
  } catch (error) {
    console.error("Create camera region error:", error);
    return res.status(500).json({
      error: "Failed to create camera region",
      message: error.message,
    });
  }
};

// GET /cameras/:cameraId/regions
// Access: user assigned to camera's plant or super_admin
const getRegionsByCamera = async (req, res) => {
  try {
    const { cameraId } = req.params;

    // 1. Pagination
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({
        error: pagination.error,
        message: pagination.error,
      });
    }
    const { page, limit, offset } = pagination;

    // 2. Camera and plant permission check
    const camera = await db.Camera.findByPk(cameraId, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!camera) {
      return res.status(404).json({
        error: "Camera not found",
        message: `Camera with ID ${cameraId} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this camera's regions",
        message: "Forbidden: you do not have access to this camera's regions",
      });
    }

    // 3. Query
    const whereClause = { camera_id: Number(cameraId) };
    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    const { count, rows } = await db.CameraRegion.findAndCountAll({
      where: whereClause,
      include: [{ model: db.ZoneSafetyRule, as: "safety_rule" }],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get camera regions error:", error);
    return res.status(500).json({
      error: "Failed to retrieve camera regions",
      message: error.message,
    });
  }
};

// PATCH /camera-regions/:id
// Access: super_admin or admin assigned to camera's plant
const updateCameraRegion = async (req, res) => {
  try {
    const { id } = req.params;

    const region = await db.CameraRegion.findByPk(id, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [{ model: db.Zone, as: "zone" }],
        },
      ],
    });

    if (!region) {
      return res.status(404).json({
        error: "Camera region not found",
        message: `Camera region with ID ${id} not found`,
      });
    }

    const camera = region.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera?.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can update camera regions",
        message: "Forbidden: only super_admin or admin assigned to this plant can update camera regions",
      });
    }

    if (req.body.id !== undefined || req.body.camera_id !== undefined) {
      return res.status(400).json({
        error: "id and camera_id cannot be modified",
        message: "id and camera_id cannot be modified",
      });
    }

    const { name, polygon, safety_rule_id, is_active } = req.body;
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

    if (polygon !== undefined) {
      const polygonCheck = validatePolygon(polygon);
      if (!polygonCheck.valid) {
        return res.status(400).json({
          error: polygonCheck.error,
          message: polygonCheck.error,
        });
      }
      updateData.polygon = polygon;
    }

    if (safety_rule_id !== undefined) {
      if (safety_rule_id === null || safety_rule_id === "") {
        updateData.safety_rule_id = null;
      } else {
        const rule = await db.ZoneSafetyRule.findByPk(safety_rule_id);
        if (!rule) {
          return res.status(404).json({
            error: "Safety rule not found",
            message: `Safety rule with ID ${safety_rule_id} not found`,
          });
        }
        if (Number(rule.zone_id) !== Number(camera.zone_id)) {
          return res.status(400).json({
            error: "Safety rule does not belong to the camera's zone",
            message: `Safety rule (Zone ID ${rule.zone_id}) does not belong to this camera's zone (Zone ID ${camera.zone_id})`,
          });
        }
        updateData.safety_rule_id = Number(safety_rule_id);
      }
    }

    if (is_active !== undefined) {
      updateData.is_active = Boolean(is_active);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: "No valid fields provided for update",
        message: "No valid fields provided for update",
      });
    }

    await region.update(updateData);

    return res.status(200).json(region);
  } catch (error) {
    console.error("Update camera region error:", error);
    return res.status(500).json({
      error: "Failed to update camera region",
      message: error.message,
    });
  }
};

// DELETE /camera-regions/:id
// Access: super_admin or admin assigned to camera's plant
// Soft disables the region (sets is_active to false)
// GET /camera-regions/:id
// Access: user assigned to camera's plant or super_admin
const getCameraRegionById = async (req, res) => {
  try {
    const { id } = req.params;

    const region = await db.CameraRegion.findByPk(id, {
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
        { model: db.ZoneSafetyRule, as: "safety_rule" },
      ],
    });

    if (!region) {
      return res.status(404).json({
        error: "Camera region not found",
        message: `Camera region with ID ${id} not found`,
      });
    }

    const camera = region.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera?.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this camera region",
        message: "Forbidden: you do not have access to this camera region",
      });
    }

    return res.status(200).json(region);
  } catch (error) {
    console.error("Get camera region by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve camera region",
      message: error.message,
    });
  }
};

// GET /camera-regions
// Access: super_admin or user assigned to that plant
const listCameraRegions = async (req, res) => {
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
    if (req.query.camera_id) {
      whereClause.camera_id = Number(req.query.camera_id);
    }
    if (req.query.safety_rule_id) {
      whereClause.safety_rule_id = Number(req.query.safety_rule_id);
    }
    if (req.query.is_active !== undefined) {
      whereClause.is_active =
        req.query.is_active === "true" || req.query.is_active === true || req.query.is_active === "1";
    }

    const { count, rows } = await db.CameraRegion.findAndCountAll({
      where: whereClause,
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
        { model: db.ZoneSafetyRule, as: "safety_rule" },
      ],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List camera regions error:", error);
    return res.status(500).json({ error: "Failed to retrieve camera regions", message: error.message, });
  }
};

const deleteCameraRegion = async (req, res) => {
  try {
    const { id } = req.params;

    const region = await db.CameraRegion.findByPk(id, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [{ model: db.Zone, as: "zone" }],
        },
      ],
    });

    if (!region) {
      return res.status(404).json({ error: "Camera region not found", message: `Camera region with ID ${id} not found`, });
    }

    const camera = region.camera;
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera?.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can disable camera regions",
        message: "Forbidden: only super_admin or admin assigned to this plant can disable camera regions",
      });
    }

    const force = req.query.force === "true" || req.query.permanent === "true";
    if (force) {
      await region.destroy();
      return res.status(200).json({ message: "Camera region deleted permanently", id: Number(id), });
    }

    await region.update({ is_active: false });

    return res.status(200).json({
      message: "Camera region disabled successfully",
      ...region.toJSON(),
      region,
    });
  } catch (error) {
    console.error("Delete camera region error:", error);
    return res.status(500).json({ error: "Failed to delete camera region", message: error.message, });
  }
};

module.exports = { createCameraRegion, listCameraRegions, getRegionsByCamera, getCameraRegionById, updateCameraRegion, deleteCameraRegion, };
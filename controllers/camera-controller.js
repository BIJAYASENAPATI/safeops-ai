const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

//  POST /zones/:zoneId/cameras - Access: Super admin or admin assigned to the zone's plant
const createCamera = async (req, res) => {
  try {
    const { zoneId } = req.params;

    // 1. Load zone and its plant
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
        error: "Cannot create camera in an inactive zone",
        message: "Cannot create camera in an inactive zone",
      });
    }

    const plant = zone.plant || (await db.Plant.findByPk(zone.plant_id));
    if (plant && plant.status !== "active") {
      return res.status(400).json({
        error: "Cannot create camera in an inactive plant",
        message: "Cannot create camera in an inactive plant",
      });
    }

    // 2. Access check
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can add cameras",
        message: "Forbidden: only super_admin or admin assigned to this plant can add cameras",
      });
    }

    // 3. Validation
    const { name, feed_type, feed_url_or_path, status } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        error: "Name is required and must be a non-empty string",
        message: "Name is required and must be a non-empty string",
      });
    }

    const allowedFeedTypes = ["upload", "simulated", "rtsp"];
    if (!feed_type || !allowedFeedTypes.includes(feed_type)) {
      return res.status(400).json({
        error: `feed_type must be one of: ${allowedFeedTypes.join(", ")}`,
        message: `feed_type must be one of: ${allowedFeedTypes.join(", ")}`,
      });
    }

    const allowedStatuses = ["online", "offline", "error"];
    if (status !== undefined && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${allowedStatuses.join(", ")}`,
        message: `status must be one of: ${allowedStatuses.join(", ")}`,
      });
    }

    // 4. Create camera taking zone_id strictly from URL
    const camera = await db.Camera.create({
      zone_id: Number(zoneId),
      name: name.trim(),
      feed_type,
      feed_url_or_path: feed_url_or_path || null,
      status: status || "offline",
      is_active: req.body.is_active !== undefined ? Boolean(req.body.is_active) : true,
    });

    return res.status(201).json(camera);
  } catch (error) {
    console.error("Create camera error:", error);
    return res.status(500).json({ error: "Failed to create camera", message: error.message, });
  }
};

//  GET /zones/:zoneId/cameras:- Access: User assigned to the zone's plant or super admin
const getCamerasByZone = async (req, res) => {
  try {
    // 1-4. Read, validate and calculate pagination parameters
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error, });
    }
    const { page, limit, offset } = pagination;

    const { zoneId } = req.params;

    // 5. Apply plant permissions, search, and other filters
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
        error: "Forbidden: you do not have access to this zone's cameras",
        message: "Forbidden: you do not have access to this zone's cameras",
      });
    }

    const whereClause = { zone_id: zoneId };
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.feed_type) {
      whereClause.feed_type = req.query.feed_type;
    }
    if (req.query.search && req.query.search.trim()) {
      whereClause.name = { [Op.like]: `%${req.query.search.trim()}%` };
    }

    // 6. Use findAndCountAll({ where, limit, offset, order: [["id", "ASC"]] })
    const { count, rows } = await db.Camera.findAndCountAll({
      where: whereClause,
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    // 7. Return standard paginated response structure
    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get cameras by zone error:", error);
    return res.status(500).json({ error: "Failed to retrieve cameras", message: error.message, });
  }
};

//  GET /cameras/:id:- Access: User assigned to the camera's zone's plant or super admin
const getCameraById = async (req, res) => {
  try {
    const { id } = req.params;

    const camera = await db.Camera.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!camera) {
      return res.status(404).json({
        error: "Camera not found",
        message: `Camera with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned =
      camera.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this camera",
        message: "Forbidden: you do not have access to this camera",
      });
    }

    return res.status(200).json(camera);
  } catch (error) {
    console.error("Get camera by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve camera",
      message: error.message,
    });
  }
};

//  PATCH /cameras/:id -  Access: Super admin or admin assigned to that plant
const updateCamera = async (req, res) => {
  try {
    const { id } = req.params;

    const camera = await db.Camera.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!camera) {
      return res.status(404).json({
        error: "Camera not found",
        message: `Camera with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can update camera",
        message: "Forbidden: only super_admin or admin assigned to this plant can update camera",
      });
    }

    if (req.body.zone_id !== undefined) {
      return res.status(400).json({
        error: "zone_id cannot be modified via ordinary camera updates",
        message: "zone_id cannot be modified via ordinary camera updates",
      });
    }

    const { name, feed_type, feed_url_or_path, status, last_heartbeat_at, is_active } = req.body;
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

    if (feed_type !== undefined) {
      const allowedFeedTypes = ["upload", "simulated", "rtsp"];
      if (!allowedFeedTypes.includes(feed_type)) {
        return res.status(400).json({
          error: `feed_type must be one of: ${allowedFeedTypes.join(", ")}`,
          message: `feed_type must be one of: ${allowedFeedTypes.join(", ")}`,
        });
      }
      updateData.feed_type = feed_type;
    }

    if (feed_url_or_path !== undefined) {
      updateData.feed_url_or_path = feed_url_or_path;
    }

    if (status !== undefined) {
      const allowedStatuses = ["online", "offline", "error"];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: `status must be one of: ${allowedStatuses.join(", ")}`,
          message: `status must be one of: ${allowedStatuses.join(", ")}`,
        });
      }
      updateData.status = status;
    }

    if (is_active !== undefined) {
      updateData.is_active = Boolean(is_active);
    }

    if (last_heartbeat_at !== undefined) {
      updateData.last_heartbeat_at = last_heartbeat_at;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: "No valid fields provided for update",
        message: "No valid fields provided for update",
      });
    }

    await camera.update(updateData);
    return res.status(200).json(camera);
  } catch (error) {
    console.error("Update camera error:", error);
    return res.status(500).json({ error: "Failed to update camera", message: error.message, });
  }
};

// PATCH/POST /cameras/:id/enable - Access: Super admin or admin assigned to camera's zone's plant
const enableCamera = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to enable cameras",
      });
    }

    const camera = await db.Camera.findByPk(id, {
      include: [
        {
          model: db.Zone,
          as: "zone",
          include: [{ model: db.Plant, as: "plant" }],
        },
      ],
    });

    if (!camera) {
      return res.status(404).json({ error: "Camera not found", message: `Camera with ID ${id} not found` });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can enable camera",
        message: "Forbidden: only super_admin or admin assigned to this plant can enable camera",
      });
    }

    // Check if zone is active
    if (camera.zone && camera.zone.status !== "active") {
      return res.status(400).json({
        error: "Cannot enable camera in an inactive zone",
        message: "Cannot enable camera in an inactive zone",
      });
    }

    // Check if plant is active
    const plant = camera.zone ? (camera.zone.plant || (await db.Plant.findByPk(camera.zone.plant_id))) : null;
    if (plant && plant.status !== "active") {
      return res.status(400).json({
        error: "Cannot enable camera in an inactive plant",
        message: "Cannot enable camera in an inactive plant",
      });
    }

    await camera.update({ is_active: true });

    return res.status(200).json({
      message: "Camera enabled successfully",
      ...camera.toJSON(),
      camera,
    });
  } catch (error) {
    console.error("Enable camera error:", error);
    return res.status(500).json({ error: "Failed to enable camera", message: error.message });
  }
};

// PATCH/POST /cameras/:id/disable - Access: Super admin or admin assigned to camera's zone's plant
const disableCamera = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to disable cameras",
      });
    }

    const camera = await db.Camera.findByPk(id, {
      include: [{ model: db.Zone, as: "zone" }],
    });

    if (!camera) {
      return res.status(404).json({ error: "Camera not found", message: `Camera with ID ${id} not found` });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      camera.zone &&
      Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: only super_admin or admin assigned to this plant can disable camera",
        message: "Forbidden: only super_admin or admin assigned to this plant can disable camera",
      });
    }

    await camera.update({ is_active: false });

    return res.status(200).json({
      message: "Camera disabled successfully",
      ...camera.toJSON(),
      camera,
    });
  } catch (error) {
    console.error("Disable camera error:", error);
    return res.status(500).json({ error: "Failed to disable camera", message: error.message });
  }
};

// PATCH /cameras/:id/status - Update camera active status
const updateCameraStatus = async (req, res) => {
  const { is_active, status } = req.body;
  if (is_active !== undefined) {
    if (Boolean(is_active) === true) {
      return enableCamera(req, res);
    } else {
      return disableCamera(req, res);
    }
  }
  if (status !== undefined) {
    if (["active", "online", "enabled"].includes(String(status).toLowerCase())) {
      return enableCamera(req, res);
    } else if (["inactive", "offline", "disabled"].includes(String(status).toLowerCase())) {
      return disableCamera(req, res);
    }
  }
  return res.status(400).json({
    error: "is_active (boolean) or status is required",
    message: "is_active (boolean) or status is required",
  });
};

// DELETE /cameras/:id - Access: Super admin or admin assigned to camera's zone's plant
const deleteCamera = async (req, res) => {
  return disableCamera(req, res);
};

module.exports = { createCamera, getCamerasByZone, getCameraById, updateCamera, deleteCamera, enableCamera, disableCamera, updateCameraStatus, };
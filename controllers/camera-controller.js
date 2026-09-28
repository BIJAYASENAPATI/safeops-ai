const db = require("../db/db-connection");

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

    if (zone.plant && zone.plant.status !== "active") {
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
    const { zoneId } = req.params;

    // 1. Load zone
    const zone = await db.Zone.findByPk(zoneId);
    if (!zone) {
      return res.status(404).json({
        error: "Zone not found",
        message: `Zone with ID ${zoneId} not found`,
      });
    }

    // 2. Access check
    const isSuperAdmin = req.user.role === "super_admin";
    const isAssigned = Number(req.user.plant_id) === Number(zone.plant_id);

    if (!isSuperAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this zone's cameras",
        message: "Forbidden: you do not have access to this zone's cameras",
      });
    }

    // 3. Find cameras
    const cameras = await db.Camera.findAll({
      where: { zone_id: zoneId },
      order: [["id", "ASC"]],
    });

    return res.status(200).json(cameras);
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

    const { name, feed_type, feed_url_or_path, status, last_heartbeat_at } = req.body;
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

module.exports = { createCamera, getCamerasByZone, getCameraById, updateCamera, };
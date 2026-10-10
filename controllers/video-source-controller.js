const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");
const { parseVideoMetadata } = require("../utils/video-metadata");

// Configure storage directory
const UPLOAD_DIR = path.join(__dirname, "../storage/videos");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer disk storage with server-controlled random filenames
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".mp4";
    const uniqueKey = `video_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
    cb(null, uniqueKey);
  },
});

const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max limit
  },
}).single("file");

// POST /cameras/:cameraId/videos
// Access: user assigned to camera's plant or super_admin
const uploadVideo = async (req, res) => {
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "File size exceeds 100 MB limit",
          message: "File size exceeds 100 MB limit",
        });
      }
      return res.status(400).json({
        error: "File upload error",
        message: err.message,
      });
    }

    const { cameraId } = req.params;

    // 1. Verify file was provided
    if (!req.file) {
      return res.status(400).json({
        error: "Video file is required under form field 'file'",
        message: "Video file is required under form field 'file'",
      });
    }

    const filePath = req.file.path;

    try {
      // 2. Camera existence & plant permission check
      const camera = await db.Camera.findByPk(cameraId, {
        include: [{ model: db.Zone, as: "zone" }],
      });

      if (!camera) {
        // Cleanup uploaded file
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(404).json({
          error: "Camera not found",
          message: `Camera with ID ${cameraId} not found`,
        });
      }

      const isSuperAdmin = req.user.role === "super_admin";
      const isAdmin = req.user.role === "admin";
      const isAssigned =
        camera.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

      if (!isSuperAdmin && !isAdmin && !isAssigned) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(403).json({
          error: "Forbidden: you do not have permission to upload videos for this camera",
          message: "Forbidden: you do not have permission to upload videos for this camera",
        });
      }

      // 3. Inspect video format & decode headers (do not trust filename)
      const metadata = await parseVideoMetadata(filePath);

      if (!metadata.valid) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({
          error: metadata.error || "Uploaded file is not a valid decodable MP4 video",
          message: metadata.error || "Uploaded file is not a valid decodable MP4 video",
        });
      }

      // Relative storage key
      const storageKey = path.relative(path.join(__dirname, ".."), filePath).replace(/\\/g, "/");

      // 4. Create VideoSource record
      const videoSource = await db.VideoSource.create({
        camera_id: Number(cameraId),
        uploaded_by: req.user.id,
        original_name: req.file.originalname,
        storage_key: storageKey,
        mime_type: req.file.mimetype || "video/mp4",
        size_bytes: req.file.size,
        duration_seconds: metadata.duration_seconds,
        width: metadata.width,
        height: metadata.height,
        status: "ready",
      });

      return res.status(201).json(videoSource);
    } catch (error) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { }
      }
      console.error("Upload video error:", error);
      return res.status(500).json({
        error: "Failed to process uploaded video",
        message: error.message,
      });
    }
  });
};

// GET /cameras/:cameraId/videos
// Access: user assigned to camera's plant or super_admin
const getVideosByCamera = async (req, res) => {
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

    // 2. Camera & permission check
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
    const isAdmin = req.user.role === "admin";
    const isAssigned =
      camera.zone && Number(req.user.plant_id) === Number(camera.zone.plant_id);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this camera's videos",
        message: "Forbidden: you do not have access to this camera's videos",
      });
    }

    // 3. Query
    const whereClause = { camera_id: Number(cameraId) };
    if (req.query.status) {
      whereClause.status = req.query.status;
    }

    const { count, rows } = await db.VideoSource.findAndCountAll({
      where: whereClause,
      include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "email", "role"] }],
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("Get videos by camera error:", error);
    return res.status(500).json({
      error: "Failed to retrieve camera videos",
      message: error.message,
    });
  }
};

// GET /videos/:id
// Access: user assigned to video's plant or super_admin
const getVideoById = async (req, res) => {
  try {
    const { id } = req.params;

    const video = await db.VideoSource.findByPk(id, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [{ model: db.Zone, as: "zone" }],
        },
        { model: db.User, as: "uploader", attributes: ["id", "name", "email", "role"] },
      ],
    });

    if (!video) {
      return res.status(404).json({
        error: "Video source not found",
        message: `Video source with ID ${id} not found`,
      });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isAssigned =
      video.camera?.zone &&
      Number(req.user.plant_id) === Number(video.camera.zone.plant_id);

    if (!isSuperAdmin && !isAdmin && !isAssigned) {
      return res.status(403).json({
        error: "Forbidden: you do not have access to this video",
        message: "Forbidden: you do not have access to this video",
      });
    }

    // If stream or download requested
    if (req.query.stream === "true" || req.query.download === "true") {
      if (video.status === "deleted") {
        return res.status(404).json({
          error: "Original video file has been deleted in accordance with data retention policy",
          message: "Original video file has been deleted in accordance with data retention policy. Historical metadata and verified event evidence remain preserved.",
        });
      }
      const fullPath = path.resolve(__dirname, "..", video.storage_key);
      if (fs.existsSync(fullPath)) {
        return res.sendFile(fullPath);
      }
    }

    return res.status(200).json(video);
  } catch (error) {
    console.error("Get video by ID error:", error);
    return res.status(500).json({
      error: "Failed to retrieve video",
      message: error.message,
    });
  }
};

// GET /videos
// Access: super_admin or user assigned to video's plant
const listVideos = async (req, res) => {
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
    if (req.query.camera_id) {
      whereClause.camera_id = Number(req.query.camera_id);
    }
    if (req.query.status) {
      whereClause.status = req.query.status;
    }
    if (req.query.uploaded_by) {
      whereClause.uploaded_by = Number(req.query.uploaded_by);
    }

    const { count, rows } = await db.VideoSource.findAndCountAll({
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
        { model: db.User, as: "uploader", attributes: ["id", "name", "email", "role"] },
      ],
      limit,
      offset,
      order: [["id", "DESC"]],
    });

    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
  } catch (error) {
    console.error("List videos error:", error);
    return res.status(500).json({
      error: "Failed to retrieve videos",
      message: error.message,
    });
  }
};

// DELETE /videos/:id
// Access: super_admin, plant admin, or uploader
const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;

    const video = await db.VideoSource.findByPk(id, {
      include: [
        {
          model: db.Camera,
          as: "camera",
          include: [{ model: db.Zone, as: "zone" }],
        },
      ],
    });

    if (!video) {
      return res.status(404).json({ error: "Video source not found", message: `Video source with ID ${id} not found`, });
    }

    const isSuperAdmin = req.user.role === "super_admin";
    const isAdmin = req.user.role === "admin";
    const isUploader = Number(req.user.id) === Number(video.uploaded_by);

    if (!isSuperAdmin && !isAdmin && !isUploader) {
      return res.status(403).json({
        error: "Forbidden: you do not have permission to delete this video",
        message: "Forbidden: you do not have permission to delete this video",
      });
    }

    // Attempt file cleanup from disk if present
    if (video.storage_key) {
      const fullPath = path.resolve(__dirname, "..", video.storage_key);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (e) { }
      }
    }

    const force = req.query.force === "true" || req.query.permanent === "true";
    if (force) {
      await video.destroy();
      return res.status(200).json({ message: "Video source deleted permanently", id: Number(id), });
    }

    await video.update({ status: "deleted" });

    return res.status(200).json({
      message: "Video source marked as deleted successfully",
      ...video.toJSON(),
      video,
    });
  } catch (error) {
    console.error("Delete video error:", error);
    return res.status(500).json({ error: "Failed to delete video source", message: error.message, });
  }
};

module.exports = { uploadVideo, listVideos, getVideosByCamera, getVideoById, deleteVideo, };
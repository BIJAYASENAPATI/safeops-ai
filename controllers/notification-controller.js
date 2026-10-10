const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");

// GET /notifications
// Access: Authenticated user (retrieves own notifications only)
const getMyNotifications = async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error });
    }
    const { page, limit, offset } = pagination;

    const whereClause = { recipient_id: Number(req.user.id) };

    if (req.query.type) {
      whereClause.type = req.query.type;
    }
    if (req.query.unread === "true") {
      whereClause.read_at = null;
    }

    const { count, rows } = await db.Notification.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Incident,
          as: "incident",
          include: [{ model: db.Zone, as: "zone" }],
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
    console.error("Get notifications error:", error);
    return res.status(500).json({
      error: "Failed to retrieve notifications",
      message: error.message,
    });
  }
};

// GET /notifications/unread-count
// Access: Authenticated user
const getUnreadCount = async (req, res) => {
  try {
    const count = await db.Notification.count({
      where: {
        recipient_id: Number(req.user.id),
        read_at: null,
      },
    });

    return res.status(200).json({ unread_count: count });
  } catch (error) {
    console.error("Get unread count error:", error);
    return res.status(500).json({
      error: "Failed to retrieve unread notification count",
      message: error.message,
    });
  }
};

// PATCH /notifications/:id/read
// Access: Authenticated user (only recipient can mark read)
const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await db.Notification.findByPk(id);

    if (!notification) {
      return res.status(404).json({
        error: "Notification not found",
        message: `Notification with ID ${id} not found`,
      });
    }

    // Strict ownership verification
    if (Number(notification.recipient_id) !== Number(req.user.id)) {
      return res.status(403).json({
        error: "Forbidden: You cannot modify notifications belonging to another user",
        message: "Forbidden: You cannot modify notifications belonging to another user",
      });
    }

    if (!notification.read_at) {
      await notification.update({ read_at: new Date() });
    }

    return res.status(200).json({
      message: "Notification marked as read successfully",
      ...notification.toJSON(),
      notification,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({
      error: "Failed to mark notification as read",
      message: error.message,
    });
  }
};

module.exports = { getMyNotifications, getUnreadCount, markNotificationRead, };
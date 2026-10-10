const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification-controller");
const authenticate = require("../middleware/authenticate");

// GET /notifications - Current user's notifications (paginated)
router.get("/", authenticate, notificationController.getMyNotifications);

// GET /notifications/unread-count - Current user's unread notification count
router.get("/unread-count", authenticate, notificationController.getUnreadCount);

// PATCH /notifications/:id/read - Mark own notification as read
router.patch("/:id/read", authenticate, notificationController.markNotificationRead);

module.exports = router;

const express = require("express");
const router = express.Router();
const incidentController = require("../controllers/incident-controller");
const authenticate = require("../middleware/authenticate");

// GET /audit-logs - Paginated list of audit logs across incidents with plant scoping
router.get("/", authenticate, incidentController.listAuditLogs);

// GET /audit-logs/:id - Single audit log entry
router.get("/:id", authenticate, incidentController.getAuditLogById);

module.exports = router;
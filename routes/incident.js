const express = require("express");
const router = express.Router();
const incidentController = require("../controllers/incident-controller");
const authenticate = require("../middleware/authenticate");

// GET /incidents - List incidents with filtering & pagination
router.get("/", authenticate, incidentController.getIncidents);

// GET /incidents/:id - Retrieve single incident with associations
router.get("/:id", authenticate, incidentController.getIncidentById);

// PATCH /incidents/:id - Update incident metadata (e.g. severity)
router.patch("/:id", authenticate, incidentController.updateIncident);

// DELETE /incidents/:id - Delete incident (super_admin or plant admin)
router.delete("/:id", authenticate, incidentController.deleteIncident);

// POST /incidents/:id/acknowledge - Acknowledge incident
router.post("/:id/acknowledge", authenticate, incidentController.acknowledgeIncident);

// POST /incidents/:id/resolve - Resolve acknowledged incident
router.post("/:id/resolve", authenticate, incidentController.resolveIncident);

// POST /incidents/:id/dismiss - Dismiss incident as false positive
router.post("/:id/dismiss", authenticate, incidentController.dismissIncident);

// GET /incidents/:id/audit-log - Retrieve incident audit log history
router.get("/:id/audit-log", authenticate, incidentController.getIncidentAuditLog);

module.exports = router;
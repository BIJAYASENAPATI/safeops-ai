const express = require("express");
const router = express.Router();
const escalationRuleController = require("../controllers/escalation-rule-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

// GET /escalation-rules - Paginated list of escalation rules
router.get("/", authenticate, escalationRuleController.listEscalationRules);

// GET /escalation-rules/:id - View single rule
router.get("/:id", authenticate, escalationRuleController.getEscalationRuleById);

// PATCH /escalation-rules/:id - Update rule (super_admin or admin assigned to that plant)
router.patch(
  "/:id",
  authenticate,
  authorizeRoles("super_admin", "admin"),
  escalationRuleController.updateEscalationRule
);

// DELETE /escalation-rules/:id - Disable or delete rule (super_admin or admin assigned to that plant)
router.delete(
  "/:id",
  authenticate,
  authorizeRoles("super_admin", "admin"),
  escalationRuleController.deleteEscalationRule
);

module.exports = router;

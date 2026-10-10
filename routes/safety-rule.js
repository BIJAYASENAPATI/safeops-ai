const express = require("express");
const router = express.Router();
const safetyRuleController = require("../controllers/safety-rule-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

// GET /safety-rules - Paginated list of safety rules with plant scoping & filters
router.get("/", authenticate, safetyRuleController.listSafetyRules);

// GET /safety-rules/:id - User assigned to rule's zone's plant or super admin
router.get("/:id", authenticate, safetyRuleController.getSafetyRuleById);

// PATCH /safety-rules/:id - Super admin or admin assigned to that plant
router.patch("/:id", authenticate, authorizeRoles("super_admin", "admin"), safetyRuleController.updateSafetyRule);

// DELETE /safety-rules/:id - Super admin or admin assigned to that plant (disables rule)
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), safetyRuleController.deleteSafetyRule);

module.exports = router;
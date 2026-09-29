const express = require("express");
const router = express.Router();
const userController = require("../controllers/user-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

router.post( "/invite", authenticate, authorizeRoles("super_admin", "admin"), userController.inviteUser );
router.get( "/", authenticate, authorizeRoles("super_admin", "admin"), userController.listUsers );
router.patch( "/plant/:id", authenticate, authorizeRoles("super_admin"), userController.assignPlant );

module.exports = router;
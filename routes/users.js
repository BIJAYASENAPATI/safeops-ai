const express = require("express");
const router = express.Router();
const userController = require("../controllers/user-controller");
const authenticate = require("../middleware/authenticate");
const authorizeRoles = require("../middleware/authorize-roles");

router.post( "/invite", authenticate, authorizeRoles("super_admin", "admin"), userController.inviteUser );
router.get( "/", authenticate, authorizeRoles("super_admin", "admin"), userController.listUsers );
router.patch( "/plant/:id", authenticate, authorizeRoles("super_admin", "admin"), userController.assignPlant );
router.get( "/:id", authenticate, userController.getUserById );

// Enable/disable user accounts - super_admin or admin only, not operator
router.patch( "/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), userController.enableUser );
router.post( "/:id/enable", authenticate, authorizeRoles("super_admin", "admin"), userController.enableUser );
router.patch( "/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), userController.disableUser );
router.post( "/:id/disable", authenticate, authorizeRoles("super_admin", "admin"), userController.disableUser );
router.patch( "/:id/status", authenticate, authorizeRoles("super_admin", "admin"), userController.updateUserStatus );

router.patch( "/:id", authenticate, authorizeRoles("super_admin", "admin"), userController.updateUser );
router.delete( "/:id", authenticate, authorizeRoles("super_admin", "admin"), userController.deleteUser );

module.exports = router;
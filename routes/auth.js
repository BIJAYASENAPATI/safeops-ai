const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth-controller");
const authenticate = require("../middleware/authenticate");

router.post("/login", authController.login);
router.post("/accept-invite", authController.acceptInvite);
router.get("/me", authenticate, authController.getMe);

module.exports = router;
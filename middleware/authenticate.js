const jwt = require("jsonwebtoken");
const db = require("../db/db-connection");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authorization token required",
        message: "Authorization token required",
      });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Authorization token required", message: "Authorization token required", });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token", message: "Invalid or expired token", });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload", message: "Invalid token payload", });
    }

    const user = await db.User.findByPk(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found", message: "User not found", });
    }

    if (user.invite_status === "pending") {
      return res.status(401).json({ error: "User invitation is pending", message: "User invitation is pending", });
    }

    if (user.account_status === "disabled") {
      return res.status(401).json({ error: "Account is disabled", message: "Account is disabled", });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authentication failed", message: error.message, });
  }
};

module.exports = authenticate;
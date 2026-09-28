const authorizeRoles = (...allowedRoles) => {
  const roles = allowedRoles.flat();

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required", message: "Authentication required", });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: you do not have permission to access this resource",
      });
    }

    next();
  };
};

const { authorizePlant, canAccessPlant } = require("./authorize-plant");

module.exports = authorizeRoles;
module.exports.authorizeRoles = authorizeRoles;
module.exports.authorizePlant = authorizePlant;
module.exports.canAccessPlant = canAccessPlant;
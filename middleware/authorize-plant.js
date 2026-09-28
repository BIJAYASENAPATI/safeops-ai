function canAccessPlant(user, targetPlantId) {
  if (!user) return false;

  // super_admin can access any plant
  if (user.role === "super_admin") {
    return true;
  }

  // Non-super_admin with null plant_id is denied plant-scoped access
  if (user.plant_id === null || user.plant_id === undefined) {
    return false;
  }

  // If a specific plant is being targeted, it must match user's assigned plant_id
  if (targetPlantId !== undefined && targetPlantId !== null && targetPlantId !== "") {
    return Number(user.plant_id) === Number(targetPlantId);
  }

  // Otherwise, user has a valid assigned plant_id
  return true;
}

// Middleware handler for checking plant access.
function handlePlantCheck(req, res, next, extractPlantId) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required", message: "Authentication required", });
  }

  // super_admin: can access any plant
  if (req.user.role === "super_admin") {
    return next();
  }

  // If plant_id is null, deny plant-scoped access unless the user is super_admin
  if (req.user.plant_id === null || req.user.plant_id === undefined) {
    return res.status(403).json({
      error: "Forbidden: user is not assigned to any plant",
      message: "Forbidden: user is not assigned to any plant",
    });
  }

  // Determine target plant ID from custom resolver, params, body, or query
  let targetPlantId;
  if (typeof extractPlantId === "function") {
    targetPlantId = extractPlantId(req);
  } else if (extractPlantId !== undefined && extractPlantId !== null) {
    targetPlantId = extractPlantId;
  } else {
    targetPlantId =
      req.params?.plant_id ??
      req.params?.plantId ??
      req.params?.id ??
      req.body?.plant_id ??
      req.query?.plant_id;
  }

  // admin, manager, operator: can access only their assigned plant_id
  if (targetPlantId !== undefined && targetPlantId !== null && targetPlantId !== "") {
    if (Number(req.user.plant_id) !== Number(targetPlantId)) {
      return res.status(403).json({
        error: "Forbidden: access to this plant is not permitted",
        message: "Forbidden: access to this plant is not permitted",
      });
    }
  }

  next();
}


const authorizePlant = (arg1, arg2, arg3) => {
  // If invoked directly as middleware: authorizePlant(req, res, next)
  if (arg1 && arg1.headers && typeof arg3 === "function") {
    return handlePlantCheck(arg1, arg2, arg3);
  }

  // Invoked as factory: authorizePlant(extractPlantId)
  const extractPlantId = arg1;
  return (req, res, next) => handlePlantCheck(req, res, next, extractPlantId);
};

module.exports = authorizePlant;
module.exports.authorizePlant = authorizePlant;
module.exports.canAccessPlant = canAccessPlant;
module.exports.handlePlantCheck = handlePlantCheck;
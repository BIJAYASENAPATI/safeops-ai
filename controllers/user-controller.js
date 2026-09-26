const crypto = require("crypto");
const db = require("../db/db-connection");

// POST /users/invite
const inviteUser = async (req, res) => {
  try {
    const { name, email, role, plant_id } = req.body;

    // 1. Basic validation
    if (!name || !email || !role) {
      return res.status(400).json({
        error: "Name, email, and role are required",
        message: "Name, email, and role are required",
      });
    }

    const normalizedRole = role.toLowerCase().trim();
    const allowedRoles = ["admin", "manager", "operator"];
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        error: `Invalid role specified. Allowed roles: ${allowedRoles.join(", ")}`,
        message: `Invalid role specified. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    // 2. Role-based inviter permissions
    let targetPlantId = null;

    if (req.user.role === "super_admin") {
      // super_admin can invite admin, manager, operator
      // Can create a plant-unassigned admin with plant_id: null, or assign to a plant
      targetPlantId = plant_id !== undefined ? plant_id : null;
    } else if (req.user.role === "admin") {
      // Plant admin can invite only manager or operator into their own plant
      if (normalizedRole === "admin") {
        return res.status(403).json({
          error: "Forbidden: plant admins cannot invite other admins",
          message: "Forbidden: plant admins cannot invite other admins",
        });
      }

      if (!req.user.plant_id) {
        return res.status(403).json({
          error: "Forbidden: admin is not assigned to any plant",
          message: "Forbidden: admin is not assigned to any plant",
        });
      }

      if (plant_id !== undefined && plant_id !== null && Number(plant_id) !== Number(req.user.plant_id)) {
        return res.status(403).json({
          error: "Forbidden: plant admins can only invite users into their own plant",
          message: "Forbidden: plant admins can only invite users into their own plant",
        });
      }

      targetPlantId = req.user.plant_id;
    } else {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to invite users",
        message: "Forbidden: insufficient permissions to invite users",
      });
    }

    // 3. Return 409 if the email already exists
    const existingUser = await db.User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        error: "A user with this email already exists",
        message: "A user with this email already exists",
      });
    }

    // 4. Generate random single-use invitation token & SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

    // 5. Create user and invitation token in a database transaction
    const result = await db.sequelize.transaction(async (t) => {
      const user = await db.User.create(
        {
          name,
          email,
          role: normalizedRole,
          plant_id: targetPlantId,
          password_hash: null,
          invite_status: "pending",
          invited_by: req.user.id,
        },
        { transaction: t }
      );

      await db.InvitationToken.create(
        {
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: expiresAt,
          used_at: null,
        },
        { transaction: t }
      );

      return user;
    });

    return res.status(201).json({
      message: "Invitation created successfully",
      token: rawToken,
      invitation_token: rawToken,
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        role: result.role,
        plant_id: result.plant_id,
        invite_status: result.invite_status,
        invited_by: result.invited_by,
      },
    });
  } catch (error) {
    console.error("Invite user error:", error);
    return res.status(500).json({
      error: "Failed to create user invitation",
      message: error.message,
    });
  }
};

// GET /users
const listUsers = async (req, res) => {
  try {
    let whereClause = {};

    if (req.user.role === "super_admin") {
      if (req.query.plant_id !== undefined && req.query.plant_id !== "") {
        whereClause.plant_id = req.query.plant_id;
      }
    } else if (req.user.role === "admin") {
      if (!req.user.plant_id) {
        return res.status(403).json({
          error: "Forbidden: admin is not assigned to any plant",
          message: "Forbidden: admin is not assigned to any plant",
        });
      }
      whereClause.plant_id = req.user.plant_id;
    } else {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: insufficient permissions",
      });
    }

    const users = await db.User.findAll({
      where: whereClause,
      attributes: ["id", "name", "email", "role", "plant_id", "invite_status"],
      order: [["id", "ASC"]],
    });

    return res.status(200).json(users);
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ error: "Failed to retrieve users", message: error.message, });
  }
};

//  PATCH /users/:id/plant -  Access: super_admin only -  Assign or reassign a user to a plant
const assignPlant = async (req, res) => {
  try {
    const { id } = req.params;
    const { plant_id } = req.body;

    // 1. Check if user exists
    const user = await db.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "User not found", message: "User not found", });
    }

    // 2. Validate plant_id presence
    if (plant_id === undefined) {
      return res.status(400).json({ error: "plant_id is required", message: "plant_id is required", });
    }

    // 3. Verify plant exists if not null
    if (plant_id !== null) {
      const plant = await db.Plant.findByPk(plant_id);
      if (!plant) {
        return res.status(404).json({
          error: "Plant not found",
          message: `Plant with ID ${plant_id} does not exist`,
        });
      }
    }

    // 4. Update user's assigned plant
    await user.update({ plant_id });

    // 5. Return updated safe user fields
    return res.status(200).json({
      message: "User plant assigned successfully",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plant_id: user.plant_id,
        invite_status: user.invite_status,
      },
    });
  } catch (error) {
    console.error("Assign plant error:", error);
    return res.status(500).json({
      error: "Failed to assign plant to user",
      message: error.message,
    });
  }
};

module.exports = { inviteUser, listUsers, assignPlant, };
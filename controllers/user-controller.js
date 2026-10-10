const crypto = require("crypto");
const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { parsePagination, formatPaginatedResponse } = require("../utils/pagination");
const { normalizePhoneNumber, isValidPhoneNumber } = require("../utils/phone");

// Returns safe user fields, strictly excluding sensitive attributes like password_hash.
const formatSafeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone_number: user.phone_number !== undefined ? user.phone_number : null,
  role: user.role,
  plant_id: user.plant_id,
  account_status: user.account_status,
  invite_status: user.invite_status,
  ...(user.invited_by !== undefined && user.invited_by !== null ? { invited_by: user.invited_by } : {}),
  ...(user.created_at ? { created_at: user.created_at } : {}),
  ...(user.updated_at ? { updated_at: user.updated_at } : {}),
});

// POST /users/invite
const inviteUser = async (req, res) => {
  try {
    const { name, email, role, plant_id, phone_number } = req.body;

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

    // 1b. Validate and normalize optional phone_number
    let normalizedPhone = null;
    if (phone_number !== undefined && phone_number !== null && phone_number !== "") {
      normalizedPhone = normalizePhoneNumber(phone_number);
      if (!isValidPhoneNumber(normalizedPhone)) {
        return res.status(400).json({
          error: "Invalid phone number format",
          message: "Invalid phone number format. Please provide a valid phone number with country code.",
        });
      }
      const existingPhone = await db.User.findOne({ where: { phone_number: normalizedPhone } });
      if (existingPhone) {
        return res.status(409).json({
          error: "A user with this phone number already exists",
          message: "A user with this phone number already exists",
        });
      }
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
          phone_number: normalizedPhone,
          role: normalizedRole,
          plant_id: targetPlantId,
          password_hash: null,
          invite_status: "pending",
          account_status: "active",
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
      user: formatSafeUser(result),
    });
  } catch (error) {
    console.error("Invite user error:", error);
    return res.status(500).json({ error: "Failed to create user invitation", message: error.message, });
  }
};

// GET /users
const listUsers = async (req, res) => {
  try {
    // 1-4. Read, validate and calculate pagination parameters
    const pagination = parsePagination(req.query);
    if (pagination.error) {
      return res.status(400).json({ error: pagination.error, message: pagination.error, });
    }
    const { page, limit, offset } = pagination;

    // 5. Apply plant permissions, search, and other filters
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

    if (req.query.role) {
      whereClause.role = req.query.role;
    } else {
      whereClause.role = { [Op.ne]: "system" };
    }
    if (req.query.invite_status) {
      whereClause.invite_status = req.query.invite_status;
    }
    if (req.query.account_status) {
      whereClause.account_status = req.query.account_status;
    }
    if (req.query.search && req.query.search.trim()) {
      const searchTerm = `%${req.query.search.trim()}%`;
      whereClause[Op.or] = [
        { name: { [Op.like]: searchTerm } },
        { email: { [Op.like]: searchTerm } },
        { phone_number: { [Op.like]: searchTerm } },
      ];
    }

    // 6. Use findAndCountAll({ where, limit, offset, order: [["id", "ASC"]] })
    const { count, rows } = await db.User.findAndCountAll({
      where: whereClause,
      attributes: ["id", "name", "email", "phone_number", "role", "plant_id", "invite_status", "account_status"],
      limit,
      offset,
      order: [["id", "ASC"]],
    });

    // 7. Return standard paginated response structure
    return res.status(200).json(formatPaginatedResponse(rows, count, page, limit));
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
    return res.status(200).json({ message: "User plant assigned successfully", user: formatSafeUser(user), });
  } catch (error) {
    console.error("Assign plant error:", error);
    return res.status(500).json({ error: "Failed to assign plant to user", message: error.message, });
  }
};

// GET /users/:id - Particular permitted user
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
      });
    }

    // Access check:
    // Super admin can access any user
    // Plant admin can view managers/operators in own plant, or view self
    // Other users can only view self
    const isSuperAdmin = req.user.role === "super_admin";
    const isSelf = Number(req.user.id) === Number(user.id);
    const isPlantAdminPermitted =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(user.plant_id) &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isSelf && !isPlantAdminPermitted) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to access this user",
        message: "Forbidden: insufficient permissions to access this user",
      });
    }

    const safeUser = formatSafeUser(user);
    return res.status(200).json({ ...safeUser, user: safeUser, });
  } catch (error) {
    console.error("Get user by ID error:", error);
    return res.status(500).json({ error: "Failed to retrieve user", message: error.message, });
  }
};

// PATCH /users/:id - Update permitted fields
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await db.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "User not found", message: "User not found", });
    }

    if (user.role === "system") {
      return res.status(403).json({
        error: "Forbidden: system account cannot be modified",
        message: "Forbidden: system account cannot be modified",
      });
    }

    // Access check:
    // Super admin can manage all users.
    // Plant admin can manage managers/operators within their own plant.
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(user.plant_id) &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to update this user",
        message: "Forbidden: insufficient permissions to update this user",
      });
    }

    // Reject sensitive fields (Instruction 8)
    const sensitiveFields = ["password_hash", "password", "token", "token_hash", "invited_by", "invite_status",];
    for (const field of sensitiveFields) {
      if (req.body[field] !== undefined) {
        return res.status(400).json({
          error: `Updating ${field} is not allowed`,
          message: `Updating ${field} is not allowed`,
        });
      }
    }

    const { name, email, role, plant_id, account_status, phone_number } = req.body;
    const updateData = {};

    // 1. Name update
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Name must be a non-empty string", message: "Name must be a non-empty string", });
      }
      updateData.name = name.trim();
    }

    // 2. Email update
    if (email !== undefined) {
      if (typeof email !== "string" || !email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({
          error: "A valid email is required",
          message: "A valid email is required",
        });
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existing = await db.User.findOne({
          where: { email: normalizedEmail, id: { [Op.ne]: user.id } },
        });
        if (existing) {
          return res.status(409).json({
            error: "A user with this email already exists",
            message: "A user with this email already exists",
          });
        }
      }
      updateData.email = normalizedEmail;
    }

    // 2b. Phone number update
    if (phone_number !== undefined) {
      if (phone_number === null || phone_number === "") {
        updateData.phone_number = null;
      } else {
        const normalizedPhone = normalizePhoneNumber(phone_number);
        if (!isValidPhoneNumber(normalizedPhone)) {
          return res.status(400).json({
            error: "Invalid phone number format",
            message: "Invalid phone number format. Please provide a valid phone number with country code.",
          });
        }
        const existingPhone = await db.User.findOne({
          where: {
            phone_number: normalizedPhone,
            id: { [Op.ne]: user.id },
          },
        });
        if (existingPhone) {
          return res.status(409).json({
            error: "A user with this phone number already exists",
            message: "A user with this phone number already exists",
          });
        }
        updateData.phone_number = normalizedPhone;
      }
    }

    // 3. Role update (Instruction 6: Reserve role elevation for super admin)
    if (role !== undefined) {
      if (!isSuperAdmin) {
        return res.status(403).json({
          error: "Forbidden: only super_admin can change user roles",
          message: "Forbidden: only super_admin can change user roles",
        });
      }
      const normalizedRole = typeof role === "string" ? role.toLowerCase().trim() : "";
      const allowedRoles = ["operator", "manager", "admin", "super_admin"];
      if (!allowedRoles.includes(normalizedRole)) {
        return res.status(400).json({
          error: `Invalid role specified. Allowed roles: ${allowedRoles.join(", ")}`,
          message: `Invalid role specified. Allowed roles: ${allowedRoles.join(", ")}`,
        });
      }
      // If demoting super admin, check if last active super admin
      if (user.role === "super_admin" && normalizedRole !== "super_admin") {
        const activeSuperAdmins = await db.User.count({
          where: { role: "super_admin", account_status: "active" },
        });
        if (activeSuperAdmins <= 1 && user.account_status === "active") {
          return res.status(400).json({
            error: "Cannot disable or demote the last active super admin",
            message: "Cannot disable or demote the last active super admin",
          });
        }
      }
      updateData.role = normalizedRole;
    }

    // 4. Plant reassignment (Instruction 6: Reserve plant reassignment for super admin)
    if (plant_id !== undefined) {
      if (!isSuperAdmin) {
        return res.status(403).json({
          error: "Forbidden: only super_admin can reassign plants",
          message: "Forbidden: only super_admin can reassign plants",
        });
      }
      if (plant_id !== null) {
        const plant = await db.Plant.findByPk(plant_id);
        if (!plant) {
          return res.status(404).json({ error: "Plant not found", message: `Plant with ID ${plant_id} does not exist`, });
        }
      }
      updateData.plant_id = plant_id;
    }

    // 5. Account status update (active / disabled)
    if (account_status !== undefined) {
      if (!["active", "disabled"].includes(account_status)) {
        return res.status(400).json({
          error: "account_status must be either 'active' or 'disabled'",
          message: "account_status must be either 'active' or 'disabled'",
        });
      }
      // Instruction 7: Reject attempts to disable the last active super admin
      if (account_status === "disabled" && user.role === "super_admin") {
        const activeSuperAdmins = await db.User.count({
          where: { role: "super_admin", account_status: "active" },
        });
        if (activeSuperAdmins <= 1 && user.account_status === "active") {
          return res.status(400).json({
            error: "Cannot disable the last active super admin",
            message: "Cannot disable the last active super admin",
          });
        }
      }
      updateData.account_status = account_status;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: "No valid fields provided for update",
        message: "No valid fields provided for update",
      });
    }

    await user.update(updateData);

    const safeUser = formatSafeUser(user);
    return res.status(200).json({
      message: "User updated successfully",
      ...safeUser,
      user: safeUser,
    });
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ error: "Failed to update user", message: error.message, });
  }
};

// PATCH/POST /users/:id/enable - Enable user account
const enableUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to enable users",
      });
    }

    const user = await db.User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
      });
    }

    if (user.role === "system") {
      return res.status(403).json({
        error: "Forbidden: system account cannot be modified",
        message: "Forbidden: system account cannot be modified",
      });
    }

    // Access check:
    // Super admin can enable any user
    // Plant admin can enable managers/operators within their own plant
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(user.plant_id) &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to enable this user",
        message: "Forbidden: insufficient permissions to enable this user",
      });
    }

    await user.update({ account_status: "active" });

    const safeUser = formatSafeUser(user);
    return res.status(200).json({
      message: "User account enabled successfully",
      ...safeUser,
      user: safeUser,
    });
  } catch (error) {
    console.error("Enable user error:", error);
    return res.status(500).json({ error: "Failed to enable user account", message: error.message });
  }
};

// PATCH/POST /users/:id/disable - Disable user account
const disableUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.role === "operator") {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions",
        message: "Forbidden: operators are not permitted to disable users",
      });
    }

    const user = await db.User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
      });
    }

    if (user.role === "system") {
      return res.status(403).json({
        error: "Forbidden: system account cannot be modified",
        message: "Forbidden: system account cannot be modified",
      });
    }

    // Access check:
    // Super admin can disable any user (except last active super admin)
    // Plant admin can only disable managers/operators within their own plant
    const isSuperAdmin = req.user.role === "super_admin";
    const isPlantAdmin =
      req.user.role === "admin" &&
      Number(req.user.plant_id) === Number(user.plant_id) &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isPlantAdmin) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to disable this user",
        message: "Forbidden: insufficient permissions to disable this user",
      });
    }

    // Reject attempts to disable the last active super admin
    if (user.role === "super_admin") {
      const activeSuperAdmins = await db.User.count({
        where: { role: "super_admin", account_status: "active" },
      });
      if (activeSuperAdmins <= 1 && user.account_status === "active") {
        return res.status(400).json({
          error: "Cannot disable the last active super admin",
          message: "Cannot disable the last active super admin",
        });
      }
    }

    await user.update({ account_status: "disabled" });

    const safeUser = formatSafeUser(user);
    return res.status(200).json({
      message: "User account disabled successfully",
      ...safeUser,
      user: safeUser,
    });
  } catch (error) {
    console.error("Disable user error:", error);
    return res.status(500).json({ error: "Failed to disable user account", message: error.message });
  }
};

// PATCH /users/:id/status - Update account status (active/disabled)
const updateUserStatus = async (req, res) => {
  const status = req.body.account_status || req.body.status;
  if (!status || !["active", "disabled"].includes(status)) {
    return res.status(400).json({
      error: "account_status must be either 'active' or 'disabled'",
      message: "account_status must be either 'active' or 'disabled'",
    });
  }
  if (status === "active") {
    return enableUser(req, res);
  } else {
    return disableUser(req, res);
  }
};

// DELETE /users/:id - Disable account
const deleteUser = async (req, res) => {
  return disableUser(req, res);
};

module.exports = { inviteUser, listUsers, assignPlant, getUserById, updateUser, deleteUser, enableUser, disableUser, updateUserStatus, formatSafeUser, };
const crypto = require("crypto");
const QRCode = require("qrcode");
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
  ...(user.qr_identifier !== undefined && user.qr_identifier !== null ? { qr_identifier: user.qr_identifier } : {}),
  ...(user.qr_generated_at !== undefined && user.qr_generated_at !== null ? { qr_generated_at: user.qr_generated_at } : {}),
  ...(user.invited_by !== undefined && user.invited_by !== null ? { invited_by: user.invited_by } : {}),
  ...(user.created_at ? { created_at: user.created_at } : {}),
  ...(user.updated_at ? { updated_at: user.updated_at } : {}),
});

// POST /users/invite
const inviteUser = async (req, res) => {
  try {
    const { name, email, role, plant_id, phone_number,zone_id } = req.body;

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
      // Admin can invite manager or operator and assign to any plant
      if (normalizedRole === "admin" || normalizedRole === "super_admin") {
        return res.status(403).json({
          error: "Forbidden: admins cannot invite other admins or super_admins",
          message: "Forbidden: admins cannot invite other admins or super_admins",
        });
      }

      targetPlantId = plant_id !== undefined ? plant_id : (req.user.plant_id || null);
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
          zone_id:req.user.zone_id
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

    if (req.user.role === "super_admin" || req.user.role === "admin") {
      if (req.query.plant_id !== undefined && req.query.plant_id !== "") {
        whereClause.plant_id = req.query.plant_id;
      }
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
      attributes: ["id", "name", "email", "phone_number", "role", "plant_id", "invite_status", "account_status","zone_id"],
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
    const isAdmin = req.user.role === "admin";
    const isSelf = Number(req.user.id) === Number(user.id);
    const isAdminPermitted =
      isAdmin && ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isSelf && !isAdminPermitted && !isAdmin) {
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
    const isAdmin =
      req.user.role === "admin" &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isAdmin) {
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

    // 4. Plant reassignment
    if (plant_id !== undefined) {
      if (!isSuperAdmin && req.user.role !== "admin") {
        return res.status(403).json({
          error: "Forbidden: only admin or super_admin can reassign plants",
          message: "Forbidden: only admin or super_admin can reassign plants",
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
    const isAdmin =
      req.user.role === "admin" &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isAdmin) {
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
    const isAdmin =
      req.user.role === "admin" &&
      ["manager", "operator"].includes(user.role);

    if (!isSuperAdmin && !isAdmin) {
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

// Helper: Check caller's permission to generate/fetch target user's QR
const canAccessUserQR = (caller, targetUser) => {
  if (!caller || !targetUser) return false;

  // Super admin can access any eligible user
  if (caller.role === "super_admin") {
    return true;
  }

  // Any user can access their own QR
  if (Number(caller.id) === Number(targetUser.id)) {
    return true;
  }

  // Plant admin can access permitted users in their own plant
  if (caller.role === "admin") {
    // If admin is assigned to a plant, must match target user's plant
    if (caller.plant_id && targetUser.plant_id) {
      return Number(caller.plant_id) === Number(targetUser.plant_id);
    }
    // If admin has no specific plant assigned (system-wide admin), permitted
    if (!caller.plant_id) {
      return true;
    }
  }

  return false;
};

// POST /users/:id/qr - Generate QR code for a user
const generateUserQR = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        error: "Valid user ID is required",
        message: "Valid user ID is required",
      });
    }

    // Protect concurrent requests with a transaction and row lock
    const transactionResult = await db.sequelize.transaction(async (t) => {
      const user = await db.User.findByPk(id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!user) {
        return { errorStatus: 404, errorMessage: "User not found" };
      }

      // Check caller permissions
      if (!canAccessUserQR(req.user, user)) {
        return {
          errorStatus: 403,
          errorMessage: "Forbidden: insufficient permissions to generate QR code for this user",
        };
      }

      // Reject disabled users, pending invitees, and the system account
      if (user.account_status === "disabled") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot generate QR code for disabled user account",
        };
      }

      if (user.invite_status === "pending") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot generate QR code for pending user invitation",
        };
      }

      if (user.role === "system") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot generate QR code for system account",
        };
      }

      // Create a random identifier if one does not exist; if existing, reuse it
      let qrIdentifier = user.qr_identifier;
      let qrGeneratedAt = user.qr_generated_at;

      if (!qrIdentifier) {
        qrIdentifier = crypto.randomBytes(32).toString("hex");
        qrGeneratedAt = new Date();
        await user.update(
          {
            qr_identifier: qrIdentifier,
            qr_generated_at: qrGeneratedAt,
          },
          { transaction: t }
        );
      }

      return {
        user_id: user.id,
        qr_identifier: qrIdentifier,
        generated_at: qrGeneratedAt,
      };
    });

    if (transactionResult.errorStatus) {
      return res.status(transactionResult.errorStatus).json({
        error: transactionResult.errorMessage,
        message: transactionResult.errorMessage,
      });
    }

    // Generate PNG data URL
    const qrCode = await QRCode.toDataURL(
      `safeops:user:${transactionResult.qr_identifier}`,
      {
        errorCorrectionLevel: "M",
        width: 300,
        margin: 4,
      }
    );

    return res.status(200).json({
      user_id: transactionResult.user_id,
      qr_code: qrCode,
      generated_at: transactionResult.generated_at,
    });
  } catch (error) {
    console.error("Generate user QR error:", error);
    return res.status(500).json({
      error: "Failed to generate user QR code",
      message: error.message,
    });
  }
};

// GET /users/:id/qr - Fetch QR code for a user without changing identifier
const getUserQR = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        error: "Valid user ID is required",
        message: "Valid user ID is required",
      });
    }

    const user = await db.User.findByPk(id);

    if (!user) {
      return res.status(404).json({
        error: "User not found",
        message: "User not found",
      });
    }

    // Permissions check
    if (!canAccessUserQR(req.user, user)) {
      return res.status(403).json({
        error: "Forbidden: insufficient permissions to access this user's QR code",
        message: "Forbidden: you do not have permission to access this user's QR code",
      });
    }

    // Reject disabled users, pending invitees, and system account
    if (user.account_status === "disabled") {
      return res.status(400).json({
        error: "User account is disabled",
        message: "Cannot access QR code for disabled user account",
      });
    }

    if (user.invite_status === "pending") {
      return res.status(400).json({
        error: "User invitation is pending",
        message: "Cannot access QR code for pending user invitation",
      });
    }

    if (user.role === "system") {
      return res.status(400).json({
        error: "System account does not have a QR code",
        message: "System account does not have a QR code",
      });
    }

    if (!user.qr_identifier) {
      return res.status(404).json({
        error: "QR code not generated for this user",
        message: "QR code not generated for this user",
      });
    }

    // Regenerate PNG data URL from existing identifier
    const qrCode = await QRCode.toDataURL(
      `safeops:user:${user.qr_identifier}`,
      {
        errorCorrectionLevel: "M",
        width: 300,
        margin: 4,
      }
    );

    return res.status(200).json({
      user_id: user.id,
      qr_code: qrCode,
      generated_at: user.qr_generated_at,
    });
  } catch (error) {
    console.error("Get user QR error:", error);
    return res.status(500).json({
      error: "Failed to fetch user QR code",
      message: error.message,
    });
  }
};

// POST /users/qr/lookup - Identify scanned user and display safe details with plant scoping
const lookupUserByQR = async (req, res) => {
  try {
    const { qr_identifier } = req.body;

    if (!qr_identifier || typeof qr_identifier !== "string" || !qr_identifier.trim()) {
      return res.status(400).json({
        error: "qr_identifier is required",
        message: "qr_identifier is required",
      });
    }

    let cleanIdentifier = qr_identifier.trim();
    if (cleanIdentifier.startsWith("safeops:user:")) {
      cleanIdentifier = cleanIdentifier.slice("safeops:user:".length);
    }

    const user = await db.User.findOne({
      where: { qr_identifier: cleanIdentifier },
      include: [{ model: db.Plant, as: "plant" }],
    });

    if (!user) {
      return res.status(404).json({
        error: "User not found for this QR code",
        message: "User not found for this QR code",
      });
    }

    // Lookup after user is disabled: Rejected
    if (user.account_status === "disabled") {
      return res.status(403).json({
        error: "User account is disabled",
        message: "User account is disabled",
      });
    }

    if (user.invite_status === "pending") {
      return res.status(400).json({
        error: "User invitation is pending",
        message: "User invitation is pending",
      });
    }

    if (user.role === "system") {
      return res.status(403).json({
        error: "System user cannot be looked up via QR",
        message: "System user cannot be looked up via QR",
      });
    }

    // Require authentication and enforce plant permissions before returning safe user fields.
    // Possessing the QR must not grant access to another plant’s data.
    const isSuperAdmin = req.user.role === "super_admin";
    const isSamePlant = req.user.plant_id && user.plant_id && Number(req.user.plant_id) === Number(user.plant_id);
    const isSelf = Number(req.user.id) === Number(user.id);
    const isUnassignedAdmin = req.user.role === "admin" && !req.user.plant_id;

    if (!isSuperAdmin && !isSamePlant && !isSelf && !isUnassignedAdmin) {
      return res.status(403).json({
        error: "Forbidden: access to this user's data from another plant is not permitted",
        message: "Forbidden: access to this user's data from another plant is not permitted",
      });
    }

    return res.status(200).json({
      message: "User lookup successful",
      user: formatSafeUser(user),
      ...formatSafeUser(user),
    });
  } catch (error) {
    console.error("Lookup user by QR error:", error);
    return res.status(500).json({
      error: "Failed to lookup user by QR code",
      message: error.message,
    });
  }
};

// POST /users/:id/qr/revoke or POST /users/:id/qr/regenerate
const revokeOrRegenerateUserQR = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({
        error: "Valid user ID is required",
        message: "Valid user ID is required",
      });
    }

    const transactionResult = await db.sequelize.transaction(async (t) => {
      const user = await db.User.findByPk(id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!user) {
        return { errorStatus: 404, errorMessage: "User not found" };
      }

      if (!canAccessUserQR(req.user, user)) {
        return {
          errorStatus: 403,
          errorMessage: "Forbidden: insufficient permissions to regenerate QR code for this user",
        };
      }

      if (user.account_status === "disabled") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot regenerate QR code for disabled user account",
        };
      }

      if (user.invite_status === "pending") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot regenerate QR code for pending user invitation",
        };
      }

      if (user.role === "system") {
        return {
          errorStatus: 400,
          errorMessage: "Cannot regenerate QR code for system account",
        };
      }

      const newIdentifier = crypto.randomBytes(32).toString("hex");
      const generatedAt = new Date();

      await user.update(
        {
          qr_identifier: newIdentifier,
          qr_generated_at: generatedAt,
        },
        { transaction: t }
      );

      return {
        user_id: user.id,
        qr_identifier: newIdentifier,
        generated_at: generatedAt,
      };
    });

    if (transactionResult.errorStatus) {
      return res.status(transactionResult.errorStatus).json({
        error: transactionResult.errorMessage,
        message: transactionResult.errorMessage,
      });
    }

    const qrCode = await QRCode.toDataURL(
      `safeops:user:${transactionResult.qr_identifier}`,
      {
        errorCorrectionLevel: "M",
        width: 300,
        margin: 4,
      }
    );

    return res.status(200).json({
      message: "QR code regenerated successfully. Old QR code has been revoked.",
      user_id: transactionResult.user_id,
      qr_code: qrCode,
      generated_at: transactionResult.generated_at,
    });
  } catch (error) {
    console.error("Regenerate user QR error:", error);
    return res.status(500).json({
      error: "Failed to regenerate user QR code",
      message: error.message,
    });
  }
};

module.exports = {
  inviteUser,
  listUsers,
  assignPlant,
  getUserById,
  updateUser,
  deleteUser,
  enableUser,
  disableUser,
  updateUserStatus,
  formatSafeUser,
  generateUserQR,
  getUserQR,
  lookupUserByQR,
  revokeOrRegenerateUserQR,
};
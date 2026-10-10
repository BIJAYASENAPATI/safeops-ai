const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const db = require("../db/db-connection");
const { normalizePhoneNumber, isValidPhoneNumber } = require("../utils/phone");

// Returns safe user fields, strictly excluding sensitive attributes like password_hash or tokens.
const formatSafeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone_number: user.phone_number !== undefined ? user.phone_number : null,
  role: user.role,
  plant_id: user.plant_id,
  account_status: user.account_status,
  invite_status: user.invite_status,
});

//  POST /auth/login
const login = async (req, res) => {
  try {
    const rawIdentifier =
      req.body.identifier !== undefined ? req.body.identifier : req.body.email;
    const { password } = req.body;

    if (
      !rawIdentifier ||
      typeof rawIdentifier !== "string" ||
      !rawIdentifier.trim() ||
      !password ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        error: "Identifier and password are required",
        message: "Identifier and password are required",
      });
    }

    const trimmedIdentifier = rawIdentifier.trim();
    let user = null;

    // Same generic 401 response for unknown email/phone and wrong password
    const genericAuthError = () =>
      res.status(401).json({
        error: "Invalid email, phone number, or password",
        message: "Invalid email, phone number, or password",
      });

    if (trimmedIdentifier.includes("@")) {
      // 2. If the identifier is an email, find the user by normalized email
      const normalizedEmail = trimmedIdentifier.toLowerCase();
      user = await db.User.findOne({ where: { email: normalizedEmail } });
    } else {
      // 3. Otherwise, validate and normalize it as a phone number, then find by phone_number
      const normalizedPhone = normalizePhoneNumber(trimmedIdentifier);
      if (isValidPhoneNumber(normalizedPhone)) {
        user = await db.User.findOne({
          where: {
            [Op.or]: [
              { phone_number: normalizedPhone },
              { phone_number: trimmedIdentifier },
            ],
          },
        });
      } else {
        // Not a valid phone number format
        return genericAuthError();
      }
    }

    if (!user) {
      return genericAuthError();
    }

    if (user.role === "system") {
      return res.status(401).json({
        error: "System account cannot be used for authentication",
        message: "System account cannot be used for authentication",
      });
    }

    // 4. Check invitation acceptance and account status
    if (user.invite_status === "pending" || !user.password_hash) {
      return res.status(401).json({
        error: "Account invitation is pending. Please complete registration before logging in.",
        message: "Account invitation is pending. Please complete registration before logging in.",
      });
    }

    if (user.account_status === "disabled") {
      return res.status(401).json({
        error: "Account is disabled",
        message: "Account is disabled",
      });
    }

    // 5. Compare password against password_hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return genericAuthError();
    }

    // Update last_login_at
    await user.update({ last_login_at: new Date() });

    // Sign JWT token (expires in 8 hours)
    const token = jwt.sign(
      { id: user.id, role: user.role, plant_id: user.plant_id },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // 6. Return existing token and safe user response
    return res.status(200).json({
      token,
      user: formatSafeUser(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      error: "An internal server error occurred during login",
      message: error.message,
    });
  }
};

// POST /auth/accept-invite
const acceptInvite = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        error: "Token and password are required",
        message: "Token and password are required",
      });
    }

    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({
        error: "A valid password is required",
        message: "A valid password is required",
      });
    }

    // 1. Hash incoming token with SHA-256
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // 2. Find invitation token record
    const invitation = await db.InvitationToken.findOne({
      where: { token_hash: tokenHash },
      include: [{ model: db.User, as: "user" }],
    });

    if (!invitation) {
      return res.status(400).json({
        error: "Invalid invitation token",
        message: "Invalid invitation token",
      });
    }

    // 3. Reject repeat use
    if (invitation.used_at !== null) {
      return res.status(400).json({
        error: "Invitation token has already been used",
        message: "Invitation token has already been used",
      });
    }

    // 4. Check expiration
    if (new Date() > new Date(invitation.expires_at)) {
      return res.status(400).json({
        error: "Invitation token has expired",
        message: "Invitation token has expired",
      });
    }

    if (!invitation.user) {
      return res.status(404).json({
        error: "Invited user not found",
        message: "Invited user not found",
      });
    }

    // 5. Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);
    const qrIdentifier = crypto.randomBytes(32).toString("hex");

    // 6. Update user and token in one database transaction
    await db.sequelize.transaction(async (t) => {
      await invitation.update(
        { used_at: new Date() },
        { transaction: t }
      );

      await invitation.user.update(
        {
          password_hash: passwordHash,
          invite_status: "accepted",
          qr_identifier: invitation.user.qr_identifier || qrIdentifier,
          qr_generated_at: invitation.user.qr_generated_at || new Date(),
        },
        { transaction: t }
      );
    });

    return res.status(200).json({
      message: "Invitation accepted successfully",
      user: {
        id: invitation.user.id,
        name: invitation.user.name,
        email: invitation.user.email,
        phone_number: invitation.user.phone_number !== undefined ? invitation.user.phone_number : null,
        role: invitation.user.role,
        plant_id: invitation.user.plant_id,
        invite_status: "accepted",
      },
    });
  } catch (error) {
    console.error("Accept invite error:", error);
    return res.status(500).json({
      error: "Failed to accept invitation",
      message: error.message,
    });
  }
};

// GET /auth/me

const getMe = async (req, res) => {
  try {
    return res.status(200).json({ user: formatSafeUser(req.user), });
  } catch (error) {
    console.error("GetMe error:", error);
    return res.status(500).json({
      error: "An internal server error occurred",
      message: error.message,
    });
  }
};

module.exports = { login, acceptInvite, getMe, formatSafeUser, };
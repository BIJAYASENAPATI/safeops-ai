const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db/db-connection");

// Returns safe user fields, strictly excluding sensitive attributes like password_hash or tokens.
const formatSafeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  plant_id: user.plant_id,
});

//  POST /auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
        message: "Email and password are required",
      });
    }

    // 1. Find user by email
    const user = await db.User.findOne({ where: { email } });

    // Same generic 401 response for unknown email and wrong password
    const genericAuthError = () =>
      res.status(401).json({
        error: "Invalid email or password",
        message: "Invalid email or password",
      });

    if (!user) {
      return genericAuthError();
    }

    // 2. Reject pending invitations or users without password_hash
    if (user.invite_status === "pending" || !user.password_hash) {
      return res.status(401).json({
        error: "Account invitation is pending. Please complete registration before logging in.",
        message: "Account invitation is pending. Please complete registration before logging in.",
      });
    }

    // 3. Compare password against password_hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return genericAuthError();
    }

    // 4. Update last_login_at
    await user.update({ last_login_at: new Date() });

    // 5. Sign JWT token (expires in 8 hours)
    const token = jwt.sign(
      { id: user.id, role: user.role, plant_id: user.plant_id, },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    // 6. Return token and safe user fields
    return res.status(200).json({ token, user: formatSafeUser(user), });
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

    // 6. Update user and token in one database transaction
    await db.sequelize.transaction(async (t) => {
      await invitation.update(
        { used_at: new Date() },
        { transaction: t }
      );

      await invitation.user.update(
        { password_hash: passwordHash, invite_status: "accepted", },
        { transaction: t }
      );
    });

    return res.status(200).json({
      message: "Invitation accepted successfully",
      user: {
        id: invitation.user.id,
        name: invitation.user.name,
        email: invitation.user.email,
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
    return res.status(200).json({
      user: formatSafeUser(req.user),
    });
  } catch (error) {
    console.error("GetMe error:", error);
    return res.status(500).json({
      error: "An internal server error occurred",
      message: error.message,
    });
  }
};

module.exports = { login, acceptInvite, getMe, formatSafeUser, };